/**
 * Flow run queries.
 *
 * The interesting function here is `createFlowRunWithOutbox`, which is where two of the platform's
 * non-negotiables meet. Everything else is reads, scoped by tenant like every other query.
 */

import { config, type FlowDefinition, type RunError, type RunSource, type RunStatus } from "@automend/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { flowRunOutbox, flowRuns } from "./schema";

export type CreateRunValues = {
  tenantId: string;
  flowId: string;
  source: RunSource;
  /** Derived from what happened, not generated here — see `buildRunIdempotencyKey`. */
  idempotencyKey: string;
  definitionSnapshot: FlowDefinition;
  triggerPayload: unknown;
};

export type CreatedRun = {
  id: string;
  status: RunStatus;
  /** False when this key had already produced a run, so a caller can answer honestly without guessing. */
  isNew: boolean;
};

/**
 * Creates a run and queues the intent to execute it, in one transaction.
 *
 * Both halves of this matter and neither works alone.
 *
 * **Idempotency.** The unique index on `(flow_id, idempotency_key)` decides, inside the database, whether
 * this run is new. A read-then-insert in application code would race with exactly the concurrent retry it
 * exists to stop — two webhook deliveries arriving together would both find nothing and both insert.
 * `DO UPDATE` rather than `DO NOTHING` because only the former returns the conflicting row, and `xmax` is
 * the only way to tell an insert from a conflict in a single statement (the same trick
 * `recordWebhookDelivery` already uses, and for the same reason).
 *
 * **The outbox.** Enqueueing a BullMQ job here directly would mean a job for a run that does not exist
 * whenever the transaction rolls back; writing only the run would mean a run nobody executes. So the
 * intent is written as a row in the same transaction, and the relay in the worker publishes it.
 *
 * The outbox row is written **only for a genuinely new run**, which is what stops a replayed delivery
 * from queueing a second execution of a run that already exists.
 */
export async function createFlowRunWithOutbox(db: Database, values: CreateRunValues): Promise<CreatedRun> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(flowRuns)
      .values({
        tenantId: values.tenantId,
        flowId: values.flowId,
        status: config.runs.initialStatus,
        source: values.source,
        idempotencyKey: values.idempotencyKey,
        definitionSnapshot: values.definitionSnapshot,
        triggerPayload: values.triggerPayload,
      })
      .onConflictDoUpdate({
        target: [flowRuns.flowId, flowRuns.idempotencyKey],
        // Nothing worth changing on a repeat. The update exists only so the conflicting row comes back,
        // which `DO NOTHING` does not do.
        set: { idempotencyKey: values.idempotencyKey },
      })
      .returning({
        id: flowRuns.id,
        status: flowRuns.status,
        isNew: sql<boolean>`(xmax = 0)`,
      });

    const run = inserted[0];

    if (!run) {
      throw new Error("Creating a flow run returned no row");
    }

    if (run.isNew) {
      await tx.insert(flowRunOutbox).values({
        tenantId: values.tenantId,
        runId: run.id,
        topic: config.queue.flowExecutions.name,
        payload: {
          executionId: run.id,
          flowId: values.flowId,
          tenantId: values.tenantId,
          idempotencyKey: values.idempotencyKey,
          triggeredAt: new Date().toISOString(),
        },
      });
    }

    return { id: run.id, status: run.status as RunStatus, isNew: run.isNew };
  });
}

/**
 * Moves a run to `running` only if it has not already been claimed.
 *
 * The `status` predicate is the claim: two workers handed the same job — which BullMQ permits after a
 * stalled-job timeout — cannot both start it, because the second update matches no row. Returning the
 * snapshot rather than requiring a second read means the caller cannot act on a definition it did not
 * successfully claim.
 */
export async function startFlowRun(
  db: Database,
  runId: string,
): Promise<{ definitionSnapshot: FlowDefinition; triggerPayload: unknown } | undefined> {
  const claimed = await db
    .update(flowRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(flowRuns.id, runId), eq(flowRuns.status, config.runs.initialStatus)))
    .returning({
      definitionSnapshot: flowRuns.definitionSnapshot,
      triggerPayload: flowRuns.triggerPayload,
    });

  return claimed[0];
}

export type FinishRunValues = {
  status: RunStatus;
  error: RunError | null;
};

/**
 * Records a run's outcome, refusing to overwrite one that already has one.
 *
 * `status = 'running'` in the predicate is what enforces the state machine in the database rather than
 * only in `runs.ts`: a late-arriving result from a killed subprocess cannot mark a timed-out run as
 * succeeded.
 */
export async function finishFlowRun(db: Database, runId: string, values: FinishRunValues): Promise<boolean> {
  const updated = await db
    .update(flowRuns)
    .set({ status: values.status, error: values.error, finishedAt: new Date() })
    .where(and(eq(flowRuns.id, runId), eq(flowRuns.status, "running")))
    .returning({ id: flowRuns.id });

  return updated.length > 0;
}

/**
 * Fails a run that never started — its flow was deleted, or its definition no longer validates.
 *
 * Separate from `finishFlowRun` because the legal predecessor state is different, and collapsing the two
 * would let a `pending` run be marked succeeded without ever having run.
 */
export async function abandonPendingRun(db: Database, runId: string, values: FinishRunValues): Promise<boolean> {
  const updated = await db
    .update(flowRuns)
    .set({ status: values.status, error: values.error, finishedAt: new Date() })
    .where(and(eq(flowRuns.id, runId), eq(flowRuns.status, config.runs.initialStatus)))
    .returning({ id: flowRuns.id });

  return updated.length > 0;
}

export type RunSummary = {
  id: string;
  tenantId: string;
  flowId: string;
  status: string;
  source: string;
  idempotencyKey: string;
  triggerPayload: unknown;
  error: RunError | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

/** The definition snapshot is deliberately absent: it is large, and a listing never needs it. */
const runSummaryColumns = {
  id: flowRuns.id,
  tenantId: flowRuns.tenantId,
  flowId: flowRuns.flowId,
  status: flowRuns.status,
  source: flowRuns.source,
  idempotencyKey: flowRuns.idempotencyKey,
  triggerPayload: flowRuns.triggerPayload,
  error: flowRuns.error,
  startedAt: flowRuns.startedAt,
  finishedAt: flowRuns.finishedAt,
  createdAt: flowRuns.createdAt,
} as const;

export async function listRunsForFlow(
  db: Database,
  tenantId: string,
  flowId: string,
  limit: number,
): Promise<RunSummary[]> {
  return await db
    .select(runSummaryColumns)
    .from(flowRuns)
    .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.flowId, flowId)))
    .orderBy(desc(flowRuns.createdAt))
    .limit(limit);
}

export async function findRunForTenant(db: Database, tenantId: string, runId: string): Promise<RunSummary | undefined> {
  const rows = await db
    .select(runSummaryColumns)
    .from(flowRuns)
    .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
    .limit(1);

  return rows[0];
}

/**
 * The run as the worker needs it: the snapshot to execute, and the tenant to scope everything else by.
 *
 * Unscoped by tenant, like `findFlowForWebhook`, and for the same structural reason — the worker has no
 * session. The tenant it returns is what scopes every write that follows.
 */
export async function findRunForExecution(
  db: Database,
  runId: string,
): Promise<{ id: string; tenantId: string; flowId: string; status: string } | undefined> {
  const rows = await db
    .select({ id: flowRuns.id, tenantId: flowRuns.tenantId, flowId: flowRuns.flowId, status: flowRuns.status })
    .from(flowRuns)
    .where(eq(flowRuns.id, runId))
    .limit(1);

  return rows[0];
}
