import { buildWebhookPath, config, type FlowDelivery } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconAction } from "@/components/ui/icon-action";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { flowQueryKeys, listDeliveries } from "@/lib/flows-api";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

const SAMPLE_BODY = JSON.stringify(
  { email: "ada@example.com", name: "Ada Lovelace", message: "Congrats on the birthday", from: "Samdani" },
  null,
  2,
);

/** Pretty-prints a body when it is JSON, and shows it as it arrived when it is not. */
function formatBody(body: string | null): string {
  if (!body) {
    return "(empty)";
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function DeliveryEntry({ delivery }: { delivery: FlowDelivery }) {
  return (
    <details className="rounded-lg bg-muted/40 ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
        <span className="rounded bg-node-sky/15 px-1.5 py-0.5 font-medium font-mono text-node-sky">
          {delivery.method}
        </span>
        <span className="text-muted-foreground">{dateTimeFormat.format(new Date(delivery.receivedAt))}</span>
        {delivery.processedAt === null && <span className="ml-auto text-muted-foreground">not run yet</span>}
      </summary>

      <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-xs leading-relaxed">
        {formatBody(delivery.body)}
      </pre>
    </details>
  );
}

export type WebhookDrawerProps = {
  flowId: string;
  /**
   * The path as *stored*, not as edited.
   *
   * The API routes on the saved definition, so a webhook that exists only in the editor has no
   * address yet. Undefined means exactly that, and the drawer says so instead of sending a request
   * that can only 404.
   */
  savedPath: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Sends a request to this flow's webhook and shows what arrived.
 *
 * The point is not the sending — anyone can curl a URL — but the round trip: the payload you send
 * here is the payload whose field names become the variables the steps below can use. Testing the
 * hook and discovering the data are the same act.
 */
export function WebhookDrawer({ flowId, savedPath, open, onOpenChange }: WebhookDrawerProps) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<string>("POST");
  const [body, setBody] = useState(SAMPLE_BODY);

  const deliveries = useQuery({
    queryKey: flowQueryKeys.deliveries(flowId),
    queryFn: ({ signal }) => listDeliveries(flowId, signal),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: async () => {
      // Straight at the webhook on this origin, exactly as an outside service would reach it —
      // no session, no client wrapper, so what is exercised is the real path.
      const response = await fetch(buildWebhookPath(flowId, savedPath ?? ""), {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });

      if (!response.ok) {
        throw new Error(`The webhook answered ${response.status}`);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.deliveries(flowId) });
    },
  });

  if (!open) {
    return null;
  }

  return (
    <aside
      aria-label="Test this webhook"
      // `lg:min-h-0` alongside `lg:h-full`: without it this flex child will not shrink below its content, so the
      // inner `overflow-y-auto` has nothing to overflow within and the page scrolls instead of the drawer.
      className="flex w-full shrink-0 flex-col border-t bg-card/40 lg:h-full lg:min-h-0 lg:w-[26rem] lg:border-t-0 lg:border-l xl:w-[30rem]"
    >
      <header className="flex items-center gap-2 border-b px-5 py-4">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-medium text-sm">Test this webhook</h2>
          <p className="text-muted-foreground text-xs">What you send becomes the variables the steps below can use.</p>
        </div>
        <IconAction label="Close" onClick={() => onOpenChange(false)}>
          <XIcon />
        </IconAction>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {savedPath === undefined && (
          <p className="rounded-lg bg-node-amber/10 px-3 py-2.5 text-node-amber text-xs leading-relaxed">
            This webhook does not exist yet. Save the flow to activate it — the address is routed from the saved
            trigger, not from what is on screen.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="test-method">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="test-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.flows.httpMethods.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="test-body">Body</Label>
          <textarea
            id="test-body"
            value={body}
            spellCheck={false}
            onChange={(event) => setBody(event.target.value)}
            className="h-40 w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>

        {send.isError && (
          <p role="alert" className="text-destructive text-xs">
            {send.error.message}
          </p>
        )}

        <Button
          size="sm"
          className="w-full"
          disabled={send.isPending || savedPath === undefined}
          onClick={() => send.mutate()}
        >
          <SendIcon data-icon="inline-start" />
          {send.isPending ? "Sending…" : "Send test request"}
        </Button>

        <div className="space-y-2">
          <h3 className="font-medium text-sm">Received</h3>

          {deliveries.isPending && <p className="text-muted-foreground text-xs">Loading…</p>}

          {deliveries.data?.length === 0 && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              Nothing yet. Send a request above, or point a real service at the URL.
            </p>
          )}

          <div className="space-y-2">
            {deliveries.data?.map((delivery) => (
              <DeliveryEntry key={delivery.id} delivery={delivery} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
