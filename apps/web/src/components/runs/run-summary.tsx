import { config, formatDurationMs, type RunStats } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleAlertIcon, PlayIcon, TimerIcon } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const { routes, flowIdParam } = config.webClient;
const { statsWindowChoices } = config.runs.dashboard;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function describeWindow(hours: number): string {
  if (hours < 24) {
    return hours === 1 ? "Last hour" : `Last ${hours} hours`;
  }

  const days = hours / 24;

  return days === 1 ? "Last 24 hours" : `Last ${days} days`;
}

function describeLastRun(lastRunAt: string | null): string {
  if (!lastRunAt) {
    return "never";
  }

  const minutes = Math.round((Date.parse(lastRunAt) - Date.now()) / 60_000);

  if (minutes > -60) {
    return relativeFormat.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);

  return hours > -48 ? relativeFormat.format(hours, "hour") : formatDateTime(lastRunAt);
}

function Tile({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          <Icon className={cn("size-3.5", tone)} />
          {label}
        </CardDescription>
        <CardTitle className="font-semibold text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {detail && <CardContent className="text-muted-foreground text-xs">{detail}</CardContent>}
    </Card>
  );
}

export function WindowPicker({ windowHours, onChange }: { windowHours: number; onChange: (hours: number) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">Time window</legend>
      {statsWindowChoices.map((hours) => (
        <Button
          key={hours}
          size="sm"
          variant={hours === windowHours ? "secondary" : "ghost"}
          aria-pressed={hours === windowHours}
          onClick={() => onChange(hours)}
        >
          {describeWindow(hours)}
        </Button>
      ))}
    </fieldset>
  );
}

export function RunTotals({ stats }: { stats: RunStats }) {
  const { total, byStatus, averageDurationMs } = stats.totals;
  const succeeded = byStatus.succeeded;
  const failed = byStatus.failed + byStatus.timedOut;
  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : undefined;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Runs"
        value={total.toLocaleString()}
        detail={describeWindow(stats.windowHours).toLowerCase()}
        icon={PlayIcon}
        tone="text-node-sky"
      />
      <Tile
        label="Succeeded"
        value={succeeded.toLocaleString()}
        detail={successRate === undefined ? "nothing to measure yet" : `${successRate}% of all runs`}
        icon={CheckCircle2Icon}
        tone="text-node-emerald"
      />
      <Tile
        label="Failed"
        value={failed.toLocaleString()}
        detail={byStatus.timedOut > 0 ? `${byStatus.timedOut.toLocaleString()} timed out` : "including timeouts"}
        icon={CircleAlertIcon}
        tone={failed > 0 ? "text-destructive" : "text-muted-foreground"}
      />
      <Tile
        label="Average duration"
        value={averageDurationMs === null ? "—" : formatDurationMs(averageDurationMs)}
        detail={
          stats.totals.longestDurationMs === null
            ? "no finished runs yet"
            : `longest ${formatDurationMs(stats.totals.longestDurationMs)}`
        }
        icon={TimerIcon}
        tone="text-node-amber"
      />
    </div>
  );
}

export function FlowStatsTable({ stats, onSelectFlow }: { stats: RunStats; onSelectFlow: (flowId: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full min-w-[42rem] text-sm">
        <thead className="bg-muted/40 text-muted-foreground text-xs">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Flow
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Runs
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Succeeded
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Failed
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Average
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Last run
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.flows.map((flow) => {
            const failed = flow.byStatus.failed + flow.byStatus.timedOut;

            return (
              <tr key={flow.flowId} className="border-t transition-colors hover:bg-muted/30">
                <td className="max-w-xs truncate px-4 py-2.5">
                  <Link
                    to={routes.flowDetail}
                    params={{ [flowIdParam]: flow.flowId }}
                    className="rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  >
                    {flow.flowName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{flow.total.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-node-emerald tabular-nums">
                  {flow.byStatus.succeeded.toLocaleString()}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums",
                    failed > 0 ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {failed.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                  {flow.averageDurationMs === null ? "—" : formatDurationMs(flow.averageDurationMs)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{describeLastRun(flow.lastRunAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="xs" variant="ghost" onClick={() => onSelectFlow(flow.flowId)}>
                    Show runs
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
