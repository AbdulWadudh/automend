/**
 * Flow runs: the shapes the API serves, and the state machine every status change goes through.
 *
 * A run and its step journal are what make retries safe. The engine may be killed mid-flow, the worker may
 * be redeployed, BullMQ may retry a job three times — and none of that may send a second email. The journal
 * is the record that lets a retry replay what already succeeded instead of doing it again, so the rules
 * about which state may follow which are load-bearing rather than bookkeeping.
 *
 * The transition rules live here, in a module with no dependencies, because a run that goes from
 * `succeeded` back to `running` is a bug no column type can catch and it is the one thing worth testing
 * exhaustively.
 */

import { z } from "zod";
import { config } from "./config";

const { runs } = config;

export const RUN_STATUSES = runs.statuses;
export const STEP_STATUSES = runs.stepStatuses;
export const RUN_SOURCES = runs.sources;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type RunSource = (typeof RUN_SOURCES)[number];

const terminalRunStatuses = new Set<string>(runs.terminalStatuses);
const terminalStepStatuses = new Set<string>(runs.terminalStepStatuses);

/** A run in a terminal state never changes again, which is what a retry relies on. */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalRunStatuses.has(status);
}

export function isTerminalStepStatus(status: StepStatus): boolean {
  return terminalStepStatuses.has(status);
}

/**
 * Which status may follow which.
 *
 * Written as an explicit map rather than a rule, because the interesting cases are the ones that are
 * *absent*: nothing leads out of a terminal state, and nothing reaches `succeeded` except by running.
 *
 * `pending → cancelled` and `pending → timedOut` are both reachable without ever running: a run whose
 * flow was deleted before the worker collected it, and one that sat in the queue past its deadline.
 */
const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  pending: ["running", "cancelled", "timedOut", "failed"],
  running: ["succeeded", "failed", "timedOut", "cancelled"],
  succeeded: [],
  failed: [],
  timedOut: [],
  cancelled: [],
};

/**
 * A step may be skipped from `pending` — the walk never reached it — but never once it has started, since a
 * step that has already acted on the world cannot be un-acted.
 */
const STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  pending: ["running", "skipped", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  skipped: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionStep(from: StepStatus, to: StepStatus): boolean {
  return STEP_TRANSITIONS[from].includes(to);
}

/**
 * The key that decides whether two attempts are the same run.
 *
 * This is the platform's second non-negotiable made concrete. A sender retrying a webhook, a poll returning
 * an item it already returned, a person double-clicking Run — each must resolve to the *same* run rather
 * than a second one, and the only way to guarantee that is for the key to be derived from what happened
 * rather than generated when it is noticed.
 *
 * So the caller supplies the external identity: the delivery's `Idempotency-Key`, the polled item's id, the
 * client's own token for a manual run. The source is part of the key because a webhook delivery and a
 * polled item could otherwise collide on a bare id.
 */
export function buildRunIdempotencyKey(source: RunSource, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * The `{ status, at }` pair that every timestamped state change produces, so a caller cannot record a
 * status without saying when it happened.
 */
export const runErrorSchema = z.object({
  /** The domain error code where there was one, so a failure is classifiable rather than only readable. */
  code: z.string(),
  message: z.string(),
  /** Which step failed. Null for a failure that was not a step's fault — a timeout, a missing definition. */
  stepId: z.uuid().nullable(),
});

export type RunError = z.infer<typeof runErrorSchema>;

export const flowStepRunSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  stepId: z.uuid(),
  /** The name the author gave the step, copied so the journal stays readable after the flow is edited. */
  stepName: z.string(),
  kitId: z.string(),
  actionName: z.string(),
  status: z.enum(STEP_STATUSES),
  /** 1 for the first try. A second row for the same step means the job was retried. */
  attempt: z.number().int().positive(),
  /** What the step was actually given, after variables were substituted. */
  input: z.unknown(),
  output: z.unknown(),
  error: runErrorSchema.nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export type FlowStepRun = z.infer<typeof flowStepRunSchema>;

export const flowRunSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  flowId: z.uuid(),
  status: z.enum(RUN_STATUSES),
  source: z.enum(RUN_SOURCES),
  idempotencyKey: z.string(),
  /** What the trigger produced, which is what the first step's variables resolve against. */
  triggerPayload: z.unknown(),
  error: runErrorSchema.nullable(),
  /** The run this one repeats. A retrigger is a new run, so the old journal stays intact. */
  retryOfRunId: z.uuid().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type FlowRun = z.infer<typeof flowRunSchema>;

export const flowRunListSchema = z.array(flowRunSchema);

/**
 * What has been started *from* this run, which is how a failure says whether anybody has dealt with it.
 * Without it a handled failure looks exactly like an untouched one, and retries pile up unnoticed.
 */
export const runRetrySummarySchema = z.object({
  count: z.number().int().nonnegative(),
  latestRunId: z.uuid().nullable(),
  latestStatus: z.enum(RUN_STATUSES).nullable(),
});

export type RunRetrySummary = z.infer<typeof runRetrySummarySchema>;

/** A run with its journal, which is what the builder and the dashboard show when somebody opens one. */
export const flowRunDetailSchema = flowRunSchema.extend({
  flowName: z.string(),
  retries: runRetrySummarySchema,
  steps: z.array(flowStepRunSchema),
});

export type FlowRunDetail = z.infer<typeof flowRunDetailSchema>;

/**
 * Starting a run by hand.
 *
 * `payload` is whatever the caller wants the flow's variables to resolve against, and `idempotencyKey` is
 * optional: a caller that wants a double-click to be one run supplies one, and a caller that does not gets
 * a fresh run each time. Making it required would be a nicer invariant and a worse API — nobody has a
 * stable id for "I pressed the button".
 */
export const startFlowRunRequestSchema = z.object({
  payload: z.unknown().optional(),
  idempotencyKey: z
    .string()
    .min(config.validation.idempotencyKey.minLength)
    .max(config.validation.idempotencyKey.maxLength)
    .optional(),
});

export type StartFlowRunRequest = z.infer<typeof startFlowRunRequestSchema>;

/** `duplicate` means a replayed key resolved to an existing run rather than starting a second one. */
export const startedRunSchema = z.object({
  runId: z.uuid(),
  duplicate: z.boolean(),
});

export type StartedRun = z.infer<typeof startedRunSchema>;

/**
 * `gestureToken` is the caller's own name for one press of the button, which is the only thing that can
 * tell an accidental double-click from a deliberate second retrigger — the server sees identical
 * requests either way. The source run is in the key too, so two runs' tokens can never collide.
 */
export function buildRetriggerIdempotencyKey(sourceRunId: string, gestureToken: string): string {
  return buildRunIdempotencyKey("manual", `retrigger:${sourceRunId}:${gestureToken}`);
}

/** The key is optional, and so is the body: omitting either means "start a new one". */
export const retriggerRunRequestSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(config.validation.idempotencyKey.minLength)
      .max(config.validation.idempotencyKey.maxLength)
      .optional(),
  })
  .default({});

export type RetriggerRunRequest = z.infer<typeof retriggerRunRequestSchema>;

/** Null when nothing has started — a queued run has no duration, and zero would read as instant. */
export function runDurationMs(
  timestamps: { startedAt: string | null; finishedAt: string | null },
  nowMs: number = Date.now(),
): number | null {
  if (!timestamps.startedAt) {
    return null;
  }

  const startedMs = Date.parse(timestamps.startedAt);
  const endedMs = timestamps.finishedAt ? Date.parse(timestamps.finishedAt) : nowMs;

  // Clocks are not monotonic across a worker restart, and a negative duration reads as a page bug.
  return Math.max(0, endedMs - startedMs);
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }

  const totalSeconds = durationMs / 1_000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
