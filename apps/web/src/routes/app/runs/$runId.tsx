import { config, type FlowRunDetail, formatDurationMs, isTerminalRunStatus, runDurationMs } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
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

function RunHeader({ run }: { run: FlowRunDetail }) {
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

          <h1 className="truncate font-semibold text-2xl tracking-tight">{run.flowName}</h1>

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

function RunDetailPage() {
  const { [runIdParam]: runId } = Route.useParams();

  const run = useQuery({
    queryKey: runQueryKeys.detail(runId),
    queryFn: ({ signal }) => getRun(runId, signal),
    // A finished run never changes again, so polling stops the moment it does.
    refetchInterval: (query) =>
      query.state.data && isTerminalRunStatus(query.state.data.status) ? false : liveRefetchIntervalMs,
  });

  if (run.isPending) {
    return <p className="px-6 py-10 text-muted-foreground">Loading the run…</p>;
  }

  if (run.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Could not load this run</CardTitle>
            <CardDescription>{run.error.message}</CardDescription>
          </CardHeader>
          <CardHeader className="flex-row gap-2">
            <Button size="sm" variant="outline" onClick={() => void run.refetch()}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to={routes.runs}>Back to runs</Link>
            </Button>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 space-y-8 overflow-y-auto px-6 py-10">
      <Link
        to={routes.runs}
        className="inline-block rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        ← Runs
      </Link>

      <RunHeader run={run.data} />

      <section className="space-y-4">
        <h2 className="font-semibold text-lg tracking-tight">Timeline</h2>
        <RunTimeline run={run.data} />
      </section>
    </div>
  );
}

export const Route = createFileRoute("/app/runs/$runId")({
  component: RunDetailPage,
});
