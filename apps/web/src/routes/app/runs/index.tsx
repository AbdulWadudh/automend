import { config, RUN_STATUSES } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { z } from "zod";
import { RunDetail } from "@/components/runs/run-detail";
import { RunList } from "@/components/runs/run-list";
import { FlowStatsTable, RunTotals, WindowPicker } from "@/components/runs/run-summary";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconAction } from "@/components/ui/icon-action";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { getRunStats, type RunListFilters, runQueryKeys } from "@/lib/runs-api";

const { defaultStatsWindowHours, layout } = config.runs.dashboard;
const { routes, runIdParam } = config.webClient;

/** Local to this file, and stable: the saved layout is keyed by them. */
const FEED_PANEL_ID = "feed";
const DETAIL_PANEL_ID = "run";

/**
 * The feed's filters live in the URL rather than in component state.
 *
 * A filtered feed is a thing people send each other and come back to, exactly like a single run is —
 * and it is the only way anything outside this page can open it narrowed to one flow. Validated with
 * Zod rather than trusted, because a search string is external input like any other: an unparseable
 * one drops to the unfiltered feed instead of reaching the query.
 */
const runsSearchSchema = z.object({
  flowId: z.uuid().optional(),
  status: z.enum(RUN_STATUSES).optional(),
});

function RunsPage() {
  const [windowHours, setWindowHours] = useState<number>(defaultStatsWindowHours);
  const [openRunId, setOpenRunId] = useState<string | undefined>(undefined);
  const isNarrow = useIsMobile();
  const navigate = useNavigate();
  const filters: RunListFilters = Route.useSearch();
  const setSearch = Route.useNavigate();

  /**
   * `replace`, so narrowing the feed does not stack a history entry per keystroke of filtering — the
   * back button should leave the page, not walk back through every filter you tried.
   */
  function setFilters(next: RunListFilters) {
    void setSearch({ search: next, replace: true });
  }

  const savedLayout = useDefaultLayout({
    id: layout.storageId,
    panelIds: [FEED_PANEL_ID, DETAIL_PANEL_ID],
    onlySaveAfterUserInteractions: true,
  });

  const stats = useQuery({
    queryKey: runQueryKeys.stats(windowHours),
    queryFn: ({ signal }) => getRunStats(windowHours, signal),
  });

  /**
   * On a narrow screen a run opens as its own page instead: a panel beside a feed needs width that is
   * not there, and the route exists anyway.
   */
  function openRun(runId: string) {
    if (isNarrow) {
      void navigate({ to: routes.runDetail, params: { [runIdParam]: runId } });

      return;
    }

    setOpenRunId(runId);
  }

  /**
   * Everything that describes the window, and nothing that grows without bound. It sits above the feed and
   * stays there while the feed scrolls, because these are the numbers a row is read against.
   */
  const summary = (
    <div className="shrink-0 space-y-6 px-6 pt-8 pb-6">
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
    </div>
  );

  /**
   * A phone has no room to hold the summary still — pinned, it would leave the feed a couple of rows — so
   * there the page is one scroll region and `RunList` grows instead of scrolling. That is the whole
   * difference: an unbounded section makes its own scroll body inert.
   */
  if (isNarrow) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="animate-in fade-in duration-200 mx-auto w-full max-w-6xl">
          {summary}
          <RunList
            filters={filters}
            openRunId={openRunId}
            className="px-6 pb-10"
            onOpenRun={openRun}
            onFiltersChange={setFilters}
          />
        </div>
      </div>
    );
  }

  const dashboard = (
    <div className="animate-in fade-in duration-200 mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
      {summary}

      <RunList
        filters={filters}
        openRunId={openRunId}
        className="min-h-0 flex-1 px-6 pb-6"
        onOpenRun={openRun}
        onFiltersChange={setFilters}
      />
    </div>
  );

  if (!openRunId) {
    return dashboard;
  }

  /**
   * The same arrangement as the builder: a panel beside the thing it belongs to, draggable, with no
   * overlay. Looking at one run must not cost the feed it was found in.
   */
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={savedLayout.defaultLayout}
      onLayoutChanged={savedLayout.onLayoutChanged}
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      <ResizablePanel id={FEED_PANEL_ID} defaultSize={layout.feedPercent} minSize={layout.minFeedPercent}>
        <div className="flex h-full min-h-0 flex-col">{dashboard}</div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel id={DETAIL_PANEL_ID} defaultSize={layout.detailPercent} minSize={layout.minDetailPercent}>
        <aside aria-label="Run detail" className="flex h-full min-h-0 flex-col border-l bg-card/40">
          <header className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
            <h2 className="min-w-0 flex-1 truncate font-medium text-sm">Run detail</h2>
            <IconAction label="Close" onClick={() => setOpenRunId(undefined)}>
              <XIcon />
            </IconAction>
          </header>

          <RunDetail
            runId={openRunId}
            className="min-h-0 flex-1 px-5 py-5"
            headingClass="truncate font-semibold text-lg tracking-tight"
            onRunStarted={openRun}
          />
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export const Route = createFileRoute("/app/runs/")({
  // `safeParse`, not `parse`: a hand-edited or stale link should land on the unfiltered feed, not on
  // an error boundary. Dropping the filter is the recoverable outcome; refusing to render is not.
  validateSearch: (search: Record<string, unknown>): RunListFilters => {
    const parsed = runsSearchSchema.safeParse(search);

    return parsed.success ? parsed.data : {};
  },
  component: RunsPage,
});
