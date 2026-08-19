import { config } from "@automend/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RunDetail } from "@/components/runs/run-detail";

const { routes, runIdParam } = config.webClient;

/**
 * The same run the feed opens in a drawer, as a page.
 *
 * Kept as a route rather than folded into the drawer because a run is a thing people send each other —
 * the timeline has to have an address, and the "Open a run by id" box goes here.
 */
function RunDetailPage() {
  const { [runIdParam]: runId } = Route.useParams();

  return (
    <div className="animate-in fade-in duration-200 mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pt-8 pb-6">
      <Link
        to={routes.runs}
        className="mb-6 inline-block shrink-0 self-start rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        ← Runs
      </Link>

      <RunDetail runId={runId} className="min-h-0 flex-1" />
    </div>
  );
}

export const Route = createFileRoute("/app/runs/$runId")({
  component: RunDetailPage,
});
