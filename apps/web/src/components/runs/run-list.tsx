import {
  config,
  formatDurationMs,
  hasRunInFlight,
  RUN_STATUSES,
  type RunListItem,
  type RunStatus,
  runDurationMs,
} from "@automend/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { CopyableId } from "@/components/runs/copyable-id";
import { FlowPicker } from "@/components/runs/flow-picker";
import { RetriggerButton } from "@/components/runs/retrigger-button";
import { describeRetries } from "@/components/runs/retry-badge";
import { RunIdSearch } from "@/components/runs/run-id-search";
import { StatusChip } from "@/components/runs/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format-time";
import { RUN_STATUS_TONES } from "@/lib/run-status";
import { listRuns, type RunListFilters, runQueryKeys } from "@/lib/runs-api";
import { cn } from "@/lib/utils";

const { pageSize, liveRefetchIntervalMs } = config.runs.dashboard;

/** Radix Select has no value for "no selection", so the absence of a filter needs a name of its own. */
const ANY = "any";

function RunRow({ run, isOpen, onOpen }: { run: RunListItem; isOpen: boolean; onOpen: (runId: string) => void }) {
  const durationMs = runDurationMs(run);
  const retryLabel = describeRetries(run.retries);

  return (
    <li
      className={cn(
        "relative flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 transition hover:-translate-y-px hover:bg-muted/30",
        isOpen ? "bg-muted/40 ring-ring" : "ring-foreground/10",
      )}
    >
      {/* A button, not a link: this opens the run beside the feed rather than navigating to it. Stretched
          over the row with `after:inset-0` so the whole item is the target, while the row still has
          exactly one thing in the tab order. */}
      <button
        type="button"
        onClick={() => onOpen(run.id)}
        className="min-w-0 flex-1 space-y-1 rounded-sm text-left after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip tone={RUN_STATUS_TONES[run.status]} />
          <span className="truncate font-medium text-sm">{run.flowName}</span>
          {run.retryOfRunId && (
            <Badge variant="outline" className="text-muted-foreground">
              <RotateCcwIcon className="size-3" />A retry
            </Badge>
          )}
          {retryLabel && (
            <Badge variant="outline" className={RUN_STATUS_TONES[run.retries.latestStatus ?? run.status].chip}>
              <RotateCcwIcon className="size-3" />
              {retryLabel}
            </Badge>
          )}
        </span>

        <span className="block text-muted-foreground text-xs tabular-nums">
          {formatDateTime(run.createdAt)} · {run.stepCount === 1 ? "1 step" : `${run.stepCount} steps`}
          {durationMs !== null && ` · took ${formatDurationMs(durationMs)}`}
        </span>
      </button>

      {/* Above the stretched button, or they would be unreachable beneath it. */}
      <span className="relative z-10 flex items-center gap-3">
        <CopyableId label="Run" value={run.id} short />

        <RetriggerButton runId={run.id} status={run.status} retries={run.retries} size="xs" variant="ghost" />
      </span>
    </li>
  );
}

export function RunList({
  filters,
  openRunId,
  className,
  onOpenRun,
  onFiltersChange,
}: {
  filters: RunListFilters;
  /** Highlighted in the list, so the panel beside it is visibly *this* row's run. */
  openRunId: string | undefined;
  /** Where the section's height comes from: bounded by the caller, the rows scroll; unbounded, they do not. */
  className?: string;
  onOpenRun: (runId: string) => void;
  onFiltersChange: (filters: RunListFilters) => void;
}) {
  const runs = useInfiniteQuery({
    queryKey: runQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) => listRuns(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    // A short page is the last page: the API returns fewer than it was asked for only when it ran out.
    getNextPageParam: (lastPage) => (lastPage.length < pageSize ? undefined : lastPage.at(-1)?.id),
    refetchInterval: (query) => {
      const loaded = query.state.data?.pages.flat() ?? [];

      return hasRunInFlight(loaded) ? liveRefetchIntervalMs : false;
    },
  });

  const loaded = runs.data?.pages.flat() ?? [];

  return (
    <section className={cn("flex flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b pb-4">
        <h2 className="font-semibold text-lg tracking-tight">Activity</h2>

        <div className="flex flex-wrap items-end gap-3">
          <RunIdSearch />

          <div className="space-y-1.5">
            <Label id="filter-flow-label" className="text-xs">
              Flow
            </Label>
            <FlowPicker
              flowId={filters.flowId}
              labelledBy="filter-flow-label"
              onChange={(flowId) => onFiltersChange({ ...filters, flowId })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-status" className="text-xs">
              Outcome
            </Label>
            <Select
              value={filters.status ?? ANY}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, status: value === ANY ? undefined : (value as RunStatus) })
              }
            >
              <SelectTrigger id="filter-status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any outcome</SelectItem>
                {RUN_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {RUN_STATUS_TONES[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* The rows are the only part that grows, so the rows are the only part that scrolls — the heading and
          the filters above stay where they were put. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pt-4 pb-1">
        {runs.isPending && <p className="text-muted-foreground text-sm">Loading runs…</p>}

        {runs.isError && (
          <Card>
            <CardHeader>
              <CardTitle>Could not load runs</CardTitle>
              <CardDescription>{runs.error.message}</CardDescription>
            </CardHeader>
            <CardHeader>
              <Button size="sm" variant="outline" className="w-fit" onClick={() => void runs.refetch()}>
                Try again
              </Button>
            </CardHeader>
          </Card>
        )}

        {runs.isSuccess && loaded.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nothing here</CardTitle>
              <CardDescription>
                {filters.flowId || filters.status
                  ? "No run matches these filters. Widen them, or pick a longer window above."
                  : "This workspace has not run anything yet. Open a flow and press Run to see it appear here."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <ul className="space-y-2">
          {loaded.map((run) => (
            <RunRow key={run.id} run={run} isOpen={run.id === openRunId} onOpen={onOpenRun} />
          ))}
        </ul>

        {runs.hasNextPage && (
          <Button
            size="sm"
            variant="outline"
            disabled={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            {runs.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </section>
  );
}
