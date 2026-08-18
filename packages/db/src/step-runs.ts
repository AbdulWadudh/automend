/**
 * The step journal — what makes retrying a flow safe rather than destructive.
 *
 * `claimStepRun` is the platform's per-step idempotency rule made concrete: check-then-act on the key
 * *inside* the database, never as a read followed by a write. Everything else here reads the journal so a
 * retry can replay what already happened.
 */

import type { RunError, StepStatus } from "@automend/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { flowStepRuns } from "./schema";

export type ClaimStepValues = {
  tenantId: string;
  runId: string;
  stepId: string;
  stepName: string;
  kitId: string;
  actionName: string;
  attempt: number;
  /** What the step will actually be given, after variables were substituted. Recorded before it runs. */
  input: unknown;
};

export type StepClaim =
  | { outcome: "claimed"; stepRunId: string }
  /** Somebody already ran this exact attempt. Its recorded result is the answer — do not invoke again. */
  | { outcome: "alreadyRecorded"; stepRunId: string; status: StepStatus; output: unknown; error: RunError | null };

/**
 * Claims the right to run one step, or reports that it has already been run.
 *
 * This is the single most important function for the platform's promise that a retry never repeats a side
 * effect. `INSERT ... ON CONFLICT DO NOTHING RETURNING` is atomic: either this caller inserted the row and
 * owns the right to invoke the action, or somebody else did and the recorded result is authoritative.
 *
 * A read followed by an insert would not do. Two workers handed the same job — which happens after a
 * stalled-job timeout — would both find no row, both insert, and both send the email.
 *
 * The claim is recorded **before** the action runs, so a subprocess killed mid-send leaves evidence that
 * the attempt was made. That is the honest failure: `running` with no result means "we do not know whether
 * this happened", which is exactly the truth, and is why a retry gets a fresh `attempt` number rather than
 * assuming the previous one did nothing.
 */
export async function claimStepRun(db: Database, values: ClaimStepValues): Promise<StepClaim> {
  const inserted = await db
    .insert(flowStepRuns)
    .values({
      tenantId: values.tenantId,
      runId: values.runId,
      stepId: values.stepId,
      stepName: values.stepName,
      kitId: values.kitId,
      actionName: values.actionName,
      status: "running",
      attempt: values.attempt,
      input: values.input,
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: [flowStepRuns.runId, flowStepRuns.stepId, flowStepRuns.attempt] })
    .returning({ id: flowStepRuns.id });

  const claimed = inserted[0];

  if (claimed) {
    return { outcome: "claimed", stepRunId: claimed.id };
  }

  // The insert conflicted, so a row for this exact attempt exists. Reading it is safe now: the row cannot
  // appear or disappear under us, only be completed by whoever owns it.
  const existing = await db
    .select({
      id: flowStepRuns.id,
      status: flowStepRuns.status,
      output: flowStepRuns.output,
      error: flowStepRuns.error,
    })
    .from(flowStepRuns)
    .where(
      and(
        eq(flowStepRuns.runId, values.runId),
        eq(flowStepRuns.stepId, values.stepId),
        eq(flowStepRuns.attempt, values.attempt),
      ),
    )
    .limit(1);

  const row = existing[0];

  if (!row) {
    throw new Error("A step claim conflicted but the conflicting row could not be read");
  }

  return {
    outcome: "alreadyRecorded",
    stepRunId: row.id,
    status: row.status as StepStatus,
    output: row.output,
    error: row.error,
  };
}

export type CompleteStepValues = {
  status: StepStatus;
  output: unknown;
  error: RunError | null;
};

/**
 * Records a step's outcome, refusing to overwrite one that already has one.
 *
 * `status = 'running'` in the predicate keeps the state machine honest in the database as well as in
 * `runs.ts` — a late result from a subprocess that was killed cannot mark a step succeeded after the run
 * has been abandoned.
 */
export async function completeStepRun(db: Database, stepRunId: string, values: CompleteStepValues): Promise<boolean> {
  const updated = await db
    .update(flowStepRuns)
    .set({ status: values.status, output: values.output, error: values.error, finishedAt: new Date() })
    .where(and(eq(flowStepRuns.id, stepRunId), eq(flowStepRuns.status, "running")))
    .returning({ id: flowStepRuns.id });

  return updated.length > 0;
}

/**
 * Records a step the walk never reached, because something before it failed.
 *
 * Written rather than left absent so the journal shows the whole shape of the run: "these three did not
 * run" is information, and an empty gap looks like data loss.
 */
export async function recordSkippedStep(db: Database, values: Omit<ClaimStepValues, "input">): Promise<void> {
  await db
    .insert(flowStepRuns)
    .values({
      tenantId: values.tenantId,
      runId: values.runId,
      stepId: values.stepId,
      stepName: values.stepName,
      kitId: values.kitId,
      actionName: values.actionName,
      status: "skipped",
      attempt: values.attempt,
    })
    .onConflictDoNothing({ target: [flowStepRuns.runId, flowStepRuns.stepId, flowStepRuns.attempt] });
}

export type StepRunSummary = {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  kitId: string;
  actionName: string;
  status: string;
  attempt: number;
  input: unknown;
  output: unknown;
  error: RunError | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/** Oldest first, which is execution order — the journal reads as the story of the run. */
export async function listStepRunsForRun(db: Database, tenantId: string, runId: string): Promise<StepRunSummary[]> {
  return await db
    .select()
    .from(flowStepRuns)
    .where(and(eq(flowStepRuns.tenantId, tenantId), eq(flowStepRuns.runId, runId)))
    .orderBy(asc(flowStepRuns.attempt), asc(flowStepRuns.startedAt));
}

/**
 * The outputs of every step that has already succeeded in this run, keyed by step id.
 *
 * Read once at the start of an attempt, and it is what makes a retry cheap as well as safe: the engine
 * resolves later steps' variables against these instead of re-invoking the steps that produced them.
 *
 * Not scoped by tenant, like the rest of the worker's reads — it has no session, and the run it was given
 * is what establishes the tenant.
 */
export async function findSucceededStepOutputs(db: Database, runId: string): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ stepId: flowStepRuns.stepId, output: flowStepRuns.output })
    .from(flowStepRuns)
    .where(and(eq(flowStepRuns.runId, runId), eq(flowStepRuns.status, "succeeded")))
    .orderBy(asc(flowStepRuns.attempt));

  return new Map(rows.map((row) => [row.stepId, row.output]));
}

/**
 * The attempt number this job should use.
 *
 * One past the highest already recorded for the run, so a retry never collides with the journal of the
 * attempt before it. Derived from the journal rather than from BullMQ's `attemptsMade` because the two can
 * disagree — a job can be handed to a second worker after a stall without its attempt count moving.
 */
export async function nextAttemptForRun(db: Database, runId: string): Promise<number> {
  const rows = await db
    .select({ attempt: flowStepRuns.attempt })
    .from(flowStepRuns)
    .where(eq(flowStepRuns.runId, runId))
    .orderBy(asc(flowStepRuns.attempt));

  const highest = rows.at(-1)?.attempt ?? 0;

  return highest + 1;
}
