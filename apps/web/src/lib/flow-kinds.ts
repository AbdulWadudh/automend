/**
 * How each trigger and step kind is presented, and what a freshly added one contains.
 *
 * The kinds themselves come from `config.flows`; this is the copy that goes with them, kept beside
 * the builder rather than in the shared config for the same reason headlines are — it is wording,
 * not configuration.
 */

import {
  config,
  type FlowStepConfig,
  type FlowStepKind,
  type FlowTriggerConfig,
  type FlowTriggerKind,
} from "@automend/shared";

export const TRIGGER_KIND_LABELS: Record<FlowTriggerKind, string> = {
  manual: "Run manually",
  webhook: "Incoming webhook",
  schedule: "On a schedule",
};

export const STEP_KIND_LABELS: Record<FlowStepKind, string> = {
  "http-request": "HTTP request",
  "send-email": "Send email",
  delay: "Wait",
  log: "Write to log",
};

/**
 * The colour a node wears, derived from what it does.
 *
 * Every class is written out in full rather than composed from the accent name, because Tailwind
 * finds classes by scanning source text — a template literal like `bg-node-${accent}` produces no
 * CSS at all. The `stroke` value is a raw custom property because it is handed to React Flow as an
 * inline SVG style rather than applied as a class.
 */
export type NodeAccent = {
  /** The icon tile: a tinted background with the accent as its foreground. */
  chip: string;
  /** The ring drawn around the node while it is selected. */
  ring: string;
  /** The connection handles, which are React Flow's own elements and need the `!` override. */
  handle: string;
  /** Edge colour, so a connection is visibly the continuation of the node it leaves. */
  stroke: string;
};

const ACCENTS = {
  emerald: {
    chip: "bg-node-emerald/15 text-node-emerald",
    ring: "ring-node-emerald/70",
    handle: "group-hover:!bg-node-emerald hover:!bg-node-emerald",
    stroke: "var(--node-emerald)",
  },
  sky: {
    chip: "bg-node-sky/15 text-node-sky",
    ring: "ring-node-sky/70",
    handle: "group-hover:!bg-node-sky hover:!bg-node-sky",
    stroke: "var(--node-sky)",
  },
  violet: {
    chip: "bg-node-violet/15 text-node-violet",
    ring: "ring-node-violet/70",
    handle: "group-hover:!bg-node-violet hover:!bg-node-violet",
    stroke: "var(--node-violet)",
  },
  amber: {
    chip: "bg-node-amber/15 text-node-amber",
    ring: "ring-node-amber/70",
    handle: "group-hover:!bg-node-amber hover:!bg-node-amber",
    stroke: "var(--node-amber)",
  },
  rose: {
    chip: "bg-node-rose/15 text-node-rose",
    ring: "ring-node-rose/70",
    handle: "group-hover:!bg-node-rose hover:!bg-node-rose",
    stroke: "var(--node-rose)",
  },
  cyan: {
    chip: "bg-node-cyan/15 text-node-cyan",
    ring: "ring-node-cyan/70",
    handle: "group-hover:!bg-node-cyan hover:!bg-node-cyan",
    stroke: "var(--node-cyan)",
  },
} as const satisfies Record<string, NodeAccent>;

/** Distinct hues, so no two kinds an author sees side by side share a colour. */
export const TRIGGER_ACCENTS: Record<FlowTriggerKind, NodeAccent> = {
  manual: ACCENTS.emerald,
  webhook: ACCENTS.rose,
  schedule: ACCENTS.cyan,
};

export const STEP_ACCENTS: Record<FlowStepKind, NodeAccent> = {
  "http-request": ACCENTS.sky,
  "send-email": ACCENTS.rose,
  delay: ACCENTS.amber,
  log: ACCENTS.violet,
};

export function createTriggerConfig(kind: FlowTriggerKind): FlowTriggerConfig {
  switch (kind) {
    case "manual":
      return { kind };
    case "webhook":
      return { kind, path: "incoming" };
    case "schedule":
      return { kind, cron: "0 9 * * *" };
  }
}

export function createStepConfig(kind: FlowStepKind): FlowStepConfig {
  switch (kind) {
    case "http-request":
      return { kind, method: config.flows.defaultHttpMethod, url: "https://example.com" };
    case "send-email":
      return { kind, to: "", subject: "", body: "" };
    case "delay":
      return { kind, durationMs: config.flows.delay.defaultMs };
    case "log":
      return { kind, message: "Step reached" };
  }
}

/** The line under a node's name on the canvas: what this node will actually do. */
export function describeTrigger(triggerConfig: FlowTriggerConfig): string {
  switch (triggerConfig.kind) {
    case "manual":
      return "Started by hand";
    case "webhook":
      return `POST /${triggerConfig.path}`;
    case "schedule":
      return triggerConfig.cron;
  }
}

export function describeStep(stepConfig: FlowStepConfig): string {
  switch (stepConfig.kind) {
    case "http-request":
      return `${stepConfig.method} ${stepConfig.url}`;
    case "send-email":
      return stepConfig.to.length > 0 ? `To ${stepConfig.to}` : "No recipients yet";
    case "delay":
      return formatDuration(stepConfig.durationMs);
    case "log":
      return stepConfig.message;
  }
}

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;

function formatDuration(durationMs: number): string {
  if (durationMs < MILLISECONDS_PER_SECOND) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / MILLISECONDS_PER_SECOND;

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds} s`;
  }

  return `${seconds / SECONDS_PER_MINUTE} min`;
}
