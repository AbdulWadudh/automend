import { config } from "@automend/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RunDetail } from "@/components/runs/run-detail";
import { useIsMobile } from "@/hooks/use-mobile";

const { routes, runIdParam } = config.webClient;

/**
 * The same run the feed opens in a drawer, as a page.
 *
 * Kept as a route rather than folded into the drawer because a run is a thing people send each other —
 * the timeline has to have an address, and the "Open a run by id" box goes here.
 */
function RunDetailPage() {
  const { [runIdParam]: runId } = Route.useParams();
  const isNarrow = useIsMobile();

  const back = (
    <Link
      to={routes.runs}
      className="inline-block shrink-0 self-start rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
    >
      ← Runs
    </Link>
  );

  /**
   * On a phone the whole page scrolls as one region.
   *
   * Pinning the run's header there leaves the timeline a few hundred pixels at the bottom of a screen
   * whose top half is already spent on ids and facts — and the timeline is what the page is for.
   * `RunDetail` takes its bounds from this class, so left unbounded it simply grows.
   */
  if (isNarrow) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="animate-in fade-in duration-200 mx-auto w-full max-w-5xl space-y-4 px-4 pt-4 pb-10">
          {back}
          <RunDetail runId={runId} />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-200 mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pt-8 pb-6">
      <span className="mb-6">{back}</span>

      <RunDetail runId={runId} className="min-h-0 flex-1" />
    </div>
  );
}

export const Route = createFileRoute("/app/runs/$runId")({
  component: RunDetailPage,
});
