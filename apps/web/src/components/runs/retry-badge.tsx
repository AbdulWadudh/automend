import { config, type RunRetrySummary } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_TONES } from "@/lib/run-status";
import { cn } from "@/lib/utils";

const { routes, runIdParam } = config.webClient;

export function describeRetries(retries: RunRetrySummary): string | undefined {
  if (retries.count === 0 || !retries.latestStatus) {
    return undefined;
  }

  const outcome = RUN_STATUS_TONES[retries.latestStatus].label.toLowerCase();

  return retries.count === 1 ? `Ran again · ${outcome}` : `Ran again ×${retries.count} · last ${outcome}`;
}

/**
 * On a run that has been started again: what came of it.
 *
 * This is the half of the lineage the run itself cannot carry — `retryOfRunId` points from the retry
 * back to its source, so without this a failure that has already been dealt with looks exactly like
 * one nobody has touched, and the same failure gets retried over and over.
 */
export function RetryBadge({ retries, asLink = true }: { retries: RunRetrySummary; asLink?: boolean }) {
  const label = describeRetries(retries);

  if (!label || !retries.latestStatus) {
    return null;
  }

  const tone = RUN_STATUS_TONES[retries.latestStatus];
  const content = (
    <>
      <RotateCcwIcon className={cn("size-3", tone.isBusy && "animate-spin")} />
      {label}
    </>
  );

  if (!asLink || !retries.latestRunId) {
    return (
      <Badge variant="outline" className={tone.chip}>
        {content}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn(tone.chip, "hover:underline")} asChild>
      <Link to={routes.runDetail} params={{ [runIdParam]: retries.latestRunId }}>
        {content}
      </Link>
    </Badge>
  );
}
