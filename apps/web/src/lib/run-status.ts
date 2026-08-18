import type { RunStatus, StepStatus } from "@automend/shared";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  ClockIcon,
  LoaderCircleIcon,
  SkipForwardIcon,
  TimerOffIcon,
} from "lucide-react";
import type { ComponentType } from "react";

export type StatusTone = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Written out in full — Tailwind scans source text, so an assembled class name yields no CSS. */
  chip: string;
  /** The dot on the timeline rail, which needs a solid fill rather than a tint. */
  dot: string;
  /** Whether the icon should spin, which is how "still going" reads without relying on colour. */
  isBusy?: boolean;
};

export const RUN_STATUS_TONES: Readonly<Record<RunStatus, StatusTone>> = {
  pending: {
    label: "Queued",
    icon: CircleDashedIcon,
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  running: {
    label: "Running",
    icon: LoaderCircleIcon,
    chip: "bg-node-sky/15 text-node-sky",
    dot: "bg-node-sky",
    isBusy: true,
  },
  succeeded: {
    label: "Succeeded",
    icon: CheckCircle2Icon,
    chip: "bg-node-emerald/15 text-node-emerald",
    dot: "bg-node-emerald",
  },
  failed: {
    label: "Failed",
    icon: CircleAlertIcon,
    chip: "bg-destructive/15 text-destructive",
    dot: "bg-destructive",
  },
  timedOut: {
    label: "Timed out",
    icon: TimerOffIcon,
    chip: "bg-node-amber/15 text-node-amber",
    dot: "bg-node-amber",
  },
  cancelled: {
    label: "Cancelled",
    icon: BanIcon,
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export const STEP_STATUS_TONES: Readonly<Record<StepStatus, StatusTone>> = {
  pending: {
    label: "Not started",
    icon: ClockIcon,
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  running: {
    label: "Running",
    icon: LoaderCircleIcon,
    chip: "bg-node-sky/15 text-node-sky",
    dot: "bg-node-sky",
    isBusy: true,
  },
  succeeded: {
    label: "Succeeded",
    icon: CheckCircle2Icon,
    chip: "bg-node-emerald/15 text-node-emerald",
    dot: "bg-node-emerald",
  },
  failed: {
    label: "Failed",
    icon: CircleAlertIcon,
    chip: "bg-destructive/15 text-destructive",
    dot: "bg-destructive",
  },
  skipped: {
    label: "Skipped",
    icon: SkipForwardIcon,
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

const RUN_SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: "Started by hand",
  webhook: "Received a webhook",
  polling: "Found by polling",
  cron: "Fired on a schedule",
};

export function describeRunSource(source: string): string {
  return RUN_SOURCE_LABELS[source] ?? source;
}
