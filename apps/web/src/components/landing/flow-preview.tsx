import { CircleCheck, GitBranch, type LucideIcon, Send, Sparkles, Webhook } from "lucide-react";

type FlowNode = {
  icon: LucideIcon;
  kind: string;
  title: string;
  detail: string;
  durationMs: number;
};

const nodes: FlowNode[] = [
  { icon: Webhook, kind: "Trigger", title: "Support ticket created", detail: "POST /hooks/zendesk", durationMs: 12 },
  { icon: Sparkles, kind: "AI step", title: "Classify urgency and topic", detail: "claude-opus-5", durationMs: 840 },
  { icon: GitBranch, kind: "Branch", title: "urgency == “high”", detail: "2 paths", durationMs: 3 },
  { icon: Send, kind: "Action", title: "Page the on-call engineer", detail: "PagerDuty", durationMs: 121 },
];

function Connector() {
  return <div className="ml-6 h-5 w-px bg-border" aria-hidden="true" />;
}

function FlowNodeCard({ node }: { node: FlowNode }) {
  const Icon = node.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{node.title}</p>
        <p className="truncate text-muted-foreground text-xs">
          {node.kind} · {node.detail}
        </p>
      </div>

      <span className="shrink-0 font-medium text-brand text-xs tabular-nums">{node.durationMs} ms</span>
    </div>
  );
}

/**
 * A mock execution of a flow, standing in for the canvas until it exists.
 *
 * `role="img"` collapses it to a single description: the node labels are illustrative sample data,
 * and read one by one they sound like real state a user could act on.
 */
export function FlowPreview() {
  return (
    <div
      role="img"
      aria-label="An example flow: a support ticket webhook triggers an AI step that classifies urgency, which branches to paging the on-call engineer. The run succeeded in 976 milliseconds."
      className="rounded-xl bg-card/60 p-4 ring-1 ring-foreground/10 backdrop-blur-sm sm:p-5"
    >
      <div className="flex items-center justify-between border-b pb-3">
        <p className="font-medium text-sm">Triage inbound support</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand text-xs">
          <CircleCheck className="size-3" />
          Succeeded
        </span>
      </div>

      <div className="pt-4">
        {nodes.map((node, index) => (
          <div key={node.title}>
            {index > 0 && <Connector />}
            <FlowNodeCard node={node} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-3 text-muted-foreground text-xs">
        <span className="font-mono">run_01JCXW·attempt 1</span>
        <span className="tabular-nums">976 ms total</span>
      </div>
    </div>
  );
}
