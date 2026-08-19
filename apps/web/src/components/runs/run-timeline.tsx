import { type FlowRunDetail, type FlowStepRun, formatDurationMs, runDurationMs } from "@automend/shared";
import { CircleAlertIcon, InboxIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PayloadPanel } from "@/components/runs/payload-panel";
import { StatusChip } from "@/components/runs/status-chip";
import { formatTimeOfDay } from "@/lib/format-time";
import { describeRunSource, RUN_STATUS_TONES, STEP_STATUS_TONES, type StatusTone } from "@/lib/run-status";
import { cn } from "@/lib/utils";

type TimelineEntry = {
  key: string;
  tone: StatusTone;
  title: string;
  subtitle?: string;
  at: string | null;
  durationMs: number | null;
  body?: ReactNode;
};

function RunError({ error }: { error: { code: string; message: string } }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-xs leading-relaxed">
      <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
      <span>
        <span className="font-medium">{error.code}</span> — {error.message}
      </span>
    </p>
  );
}

function buildStepEntry(step: FlowStepRun, nowMs: number): TimelineEntry {
  const tone = STEP_STATUS_TONES[step.status];

  return {
    key: step.id,
    tone,
    title: step.stepName,
    subtitle: `${step.kitId}.${step.actionName}${step.attempt > 1 ? ` · attempt ${step.attempt}` : ""}`,
    at: step.startedAt,
    durationMs: runDurationMs(step, nowMs),
    body: (
      <>
        {step.error && <RunError error={step.error} />}
        {step.input !== null && step.input !== undefined && <PayloadPanel label="Sent" value={step.input} />}
        {step.output !== null && step.output !== undefined && <PayloadPanel label="Returned" value={step.output} />}
      </>
    ),
  };
}

function buildEntries(run: FlowRunDetail, nowMs: number): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      key: "received",
      tone: {
        label: "Received",
        icon: InboxIcon,
        chip: "bg-node-violet/15 text-node-violet",
        dot: "bg-node-violet",
      },
      title: describeRunSource(run.source),
      subtitle: "What the flow was given to work with",
      at: run.createdAt,
      durationMs: null,
      body: <PayloadPanel label="Data" value={run.triggerPayload} />,
    },
    ...run.steps.map((step) => buildStepEntry(step, nowMs)),
  ];

  if (run.finishedAt) {
    const tone = RUN_STATUS_TONES[run.status];

    entries.push({
      key: "finished",
      tone,
      title: `Run ${tone.label.toLowerCase()}`,
      at: run.finishedAt,
      durationMs: runDurationMs(run, nowMs),
      // The run-level error is the one no step owns: a timeout, a definition that stopped validating.
      body: run.error && run.error.stepId === null ? <RunError error={run.error} /> : undefined,
    });
  }

  return entries;
}

/** Milliseconds from the moment the run was created, which is what "and then" means on this page. */
function describeOffset(at: string | null, startedIso: string): string | undefined {
  if (!at) {
    return undefined;
  }

  const offsetMs = Date.parse(at) - Date.parse(startedIso);

  return offsetMs > 0 ? `+${formatDurationMs(offsetMs)}` : undefined;
}

export function RunTimeline({ run }: { run: FlowRunDetail }) {
  const nowMs = Date.now();
  const entries = buildEntries(run, nowMs);

  return (
    <ol className="space-y-1">
      {entries.map((entry, index) => {
        const Icon = entry.tone.icon;
        const offset = describeOffset(entry.at, run.createdAt);
        const isLast = index === entries.length - 1;

        return (
          <li key={entry.key} className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <span className={cn("size-2.5 shrink-0 rounded-full", entry.tone.dot)} />
              {!isLast && <span className="w-px flex-1 bg-border" />}
            </div>

            <div className={cn("min-w-0 flex-1 space-y-2", isLast ? "pb-1" : "pb-5 sm:pb-6")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", entry.tone.isBusy && "animate-spin")} />
                <span className="font-medium text-sm">{entry.title}</span>
                <StatusChip tone={entry.tone} />

                <span className="flex w-full items-center gap-2 text-muted-foreground text-xs tabular-nums sm:ml-auto sm:w-auto">
                  {entry.at && <time dateTime={entry.at}>{formatTimeOfDay(entry.at)}</time>}
                  {offset && <span>{offset}</span>}
                  {entry.durationMs !== null && <span>took {formatDurationMs(entry.durationMs)}</span>}
                </span>
              </div>

              {entry.subtitle && <p className="text-muted-foreground text-xs">{entry.subtitle}</p>}

              {entry.body && <div className="space-y-2">{entry.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
