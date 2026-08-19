import { config, type FlowRunDetail, formatDurationMs, isTerminalRunStatus, runDurationMs } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RotateCcwIcon } from "lucide-react";
import { CopyableId } from "@/components/runs/copyable-id";
import { RetriggerButton } from "@/components/runs/retrigger-button";
import { RetryBadge } from "@/components/runs/retry-badge";
import { RunTimeline } from "@/components/runs/run-timeline";
import { StatusChip } from "@/components/runs/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format-time";
import { describeRunSource, RUN_STATUS_TONES } from "@/lib/run-status";
import { getRun, runQueryKeys } from "@/lib/runs-api";
import { cn } from "@/lib/utils";

const { routes, runIdParam, flowIdParam } = config.webClient;
const { liveRefetchIntervalMs } = config.runs.dashboard;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function RunHeader({ run, headingClass }: { run: FlowRunDetail; headingClass: string }) {
  const durationMs = runDurationMs(run);
  const failedSteps = run.steps.filter((step) => step.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={RUN_STATUS_TONES[run.status]} />
            {run.retryOfRunId && (
              <Badge variant="outline" className="hover:underline" asChild>
                <Link to={routes.runDetail} params={{ [runIdParam]: run.retryOfRunId }}>
                  <RotateCcwIcon className="size-3" />A retry of an earlier run
                </Link>
              </Badge>
            )}
            <RetryBadge retries={run.retries} />
          </div>

          <h1 className={headingClass}>{run.flowName}</h1>

          <p className="text-muted-foreground text-sm">
            {describeRunSource(run.source)} ·{" "}
            <Link
              to={routes.flowDetail}
              params={{ [flowIdParam]: run.flowId }}
              className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            >
              Open the flow
            </Link>
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <CopyableId label="Run" value={run.id} />
            <CopyableId label="Flow" value={run.flowId} />
          </div>
        </div>

        <RetriggerButton runId={run.id} status={run.status} retries={run.retries} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-foreground/10 sm:grid-cols-4">
        <Fact label="Received" value={formatDateTime(run.createdAt)} />
        <Fact label="Finished" value={run.finishedAt ? formatDateTime(run.finishedAt) : "—"} />
        <Fact label="Total time" value={durationMs === null ? "not started" : formatDurationMs(durationMs)} />
        <Fact
          label="Steps"
          value={failedSteps > 0 ? `${run.steps.length} · ${failedSteps} failed` : String(run.steps.length)}
        />
      </dl>

      {run.error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive text-sm leading-relaxed">
          <span className="font-medium">{run.error.code}</span> — {run.error.message}
        </p>
      )}

      {isTerminalRunStatus(run.status) && run.status !== "succeeded" && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Running it again starts a new run with this same data, against the flow as it is now — so fix the step above
          first, then press Run again.
        </p>
      )}
    </div>
  );
}

/**
 * One run, whether it is the page or the drawer.
 *
 * Shared so the two cannot drift: opening a run from the feed and opening its URL are the same thing seen
 * through different frames, and a drawer that showed a subset would make the deep link the "real" one.
 *
 * `headingClass` is the only difference the frames need — a drawer's title sits at the scale of the panel
 * it is in, not at the scale of a page.
 */
export function RunDetail({
  runId,
  className,
  headingClass = "truncate font-semibold text-2xl tracking-tight",
}: {
  runId: string;
  /** Where this panel's height comes from: bounded by the caller, the timeline scrolls; unbounded, it does not. */
  className?: string;
  headingClass?: string;
}) {
  const run = useQuery({
    queryKey: runQueryKeys.detail(runId),
    queryFn: ({ signal }) => getRun(runId, signal),
    // A finished run never changes again, so polling stops the moment it does.
    refetchInterval: (query) =>
      query.state.data && isTerminalRunStatus(query.state.data.status) ? false : liveRefetchIntervalMs,
  });

  if (run.isPending) {
    return (
      <div className={className}>
        <p className="text-muted-foreground text-sm">Loading the run…</p>
      </div>
    );
  }

  if (run.isError) {
    return (
      <div className={className}>
        <Card>
          <CardHeader>
            <CardTitle>Could not load this run</CardTitle>
            <CardDescription>{run.error.message}</CardDescription>
          </CardHeader>
          <CardHeader>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => void run.refetch()}>
              Try again
            </Button>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* What the run *is* stays put. Only the timeline below it grows, so only the timeline scrolls —
          scrolling to a later step must not carry the status, the ids and the failure off the screen you
          are reading the step against. */}
      <div className="shrink-0 pb-8">
        <RunHeader run={run.data} headingClass={headingClass} />
      </div>

      <section className="flex min-h-0 flex-1 flex-col">
        <h2 className="shrink-0 border-b pb-4 font-semibold text-lg tracking-tight">Timeline</h2>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-5 pb-1">
          <RunTimeline run={run.data} />
        </div>
      </section>
    </div>
  );
}
