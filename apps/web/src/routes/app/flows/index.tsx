import { config } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon, WorkflowIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { FlowCard } from "@/components/flows/flow-card";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { createFlow, flowQueryKeys, listFlows } from "@/lib/flows-api";

const { flowName } = config.validation;
const { routes, flowIdParam } = config.webClient;

/**
 * Naming a flow, then landing in it.
 *
 * A modal rather than a field in the header: creating a flow is a step on the way to editing one, so
 * it ends on the canvas rather than back at a list with one more card in it. The header field made
 * the page look like its own primary job was typing a name.
 */
function NewFlowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => createFlow({ name: name.trim() }),
    onSuccess: async (created) => {
      setName("");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.lists() });
      await navigate({ to: routes.flowDetail, params: { [flowIdParam]: created.id } });
    },
    onError: (error) => toast.error("Could not create the flow", { description: error.message }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim().length >= flowName.minLength) {
      create.mutate();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A half-typed name has no reason to survive a dismissal, and reopening to yesterday's draft
        // is the kind of memory nobody asked for.
        if (!next) {
          setName("");
        }

        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Name your flow</DialogTitle>
          <DialogDescription>It opens with a trigger already in place — add steps from there.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-flow-name">Name</Label>
            <Input
              id="new-flow-name"
              value={name}
              maxLength={flowName.maxLength}
              placeholder="Send a welcome email"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">You can rename it at any time.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length < flowName.minLength}>
              {create.isPending ? "Creating…" : "Create and open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shaped like the card it stands in for, so nothing moves when the real ones arrive. */
function FlowCardSkeleton() {
  return (
    <div className="rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-6 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

function FlowsPage() {
  const [isCreating, setIsCreating] = useState(false);

  const flows = useQuery({
    queryKey: flowQueryKeys.list(),
    queryFn: ({ signal }) => listFlows({}, signal),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-in fade-in duration-200 mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl tracking-tight">Flows</h1>
            <p className="text-muted-foreground">Everything in this workspace. Open one to edit it on the canvas.</p>
          </div>

          <Button onClick={() => setIsCreating(true)}>
            <PlusIcon />
            New flow
          </Button>
        </div>

        {flows.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
            <span className="sr-only">Loading your flows…</span>
            {Array.from({ length: 6 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key by.
              <FlowCardSkeleton key={index} />
            ))}
          </div>
        )}

        {flows.isError && (
          <Card>
            <CardHeader>
              <CardTitle>Could not load your flows</CardTitle>
              <CardDescription>{flows.error.message}</CardDescription>
            </CardHeader>
            <CardHeader>
              <Button size="sm" variant="outline" className="w-fit" onClick={() => void flows.refetch()}>
                Try again
              </Button>
            </CardHeader>
          </Card>
        )}

        {flows.data?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <WorkflowIcon className="size-8 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">No flows yet</p>
              <p className="max-w-sm text-muted-foreground text-sm">
                A flow opens with a trigger already in place — add steps from there.
              </p>
            </div>
            <Button variant="outline" onClick={() => setIsCreating(true)}>
              <PlusIcon />
              Create your first flow
            </Button>
          </div>
        )}

        {flows.data && flows.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {flows.data.map((flow) => (
              <FlowCard key={flow.id} flow={flow} />
            ))}
          </div>
        )}

        <NewFlowDialog open={isCreating} onOpenChange={setIsCreating} />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/app/flows/")({
  component: FlowsPage,
});
