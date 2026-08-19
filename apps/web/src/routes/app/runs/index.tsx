import { config } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RunList } from "@/components/runs/run-list";
import { FlowStatsTable, RunTotals, WindowPicker } from "@/components/runs/run-summary";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunStats, type RunListFilters, runQueryKeys } from "@/lib/runs-api";

const { defaultStatsWindowHours } = config.runs.dashboard;

function RunsPage() {
  const [windowHours, setWindowHours] = useState<number>(defaultStatsWindowHours);
  const [filters, setFilters] = useState<RunListFilters>({});

  const stats = useQuery({
    queryKey: runQueryKeys.stats(windowHours),
    queryFn: ({ signal }) => getRunStats(windowHours, signal),
  });

  return (
    <div className="animate-in fade-in duration-200 mx-auto w-full max-w-6xl flex-1 space-y-8 overflow-y-auto px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">Runs</h1>
          <p className="text-muted-foreground">
            What each flow received, what it did next, and how it ended. Open a run for its timeline.
          </p>
        </div>

        <WindowPicker windowHours={windowHours} onChange={setWindowHours} />
      </div>

      {stats.isPending && <p className="text-muted-foreground text-sm">Loading the summary…</p>}

      {stats.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Could not load the summary</CardTitle>
            <CardDescription>{stats.error.message}</CardDescription>
          </CardHeader>
          <CardHeader>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => void stats.refetch()}>
              Try again
            </Button>
          </CardHeader>
        </Card>
      )}

      {stats.data && (
        <div className="space-y-6">
          <RunTotals stats={stats.data} />

          {stats.data.flows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-semibold text-lg tracking-tight">By flow</h2>
              <FlowStatsTable stats={stats.data} onSelectFlow={(flowId) => setFilters({ ...filters, flowId })} />
            </section>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No runs in this window</CardTitle>
                <CardDescription>
                  Nothing ran in the last {stats.data.windowHours} hours. Pick a longer window above, or start a flow by
                  hand to see it here.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      )}

      <RunList filters={filters} onFiltersChange={setFilters} />
    </div>
  );
}

export const Route = createFileRoute("/app/runs/")({
  component: RunsPage,
});
