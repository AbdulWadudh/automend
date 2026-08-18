/**
 * The outbox relay's side of the transactional outbox.
 *
 * Rows are written by whoever creates a run (see `createFlowRunWithOutbox`); this module is how the worker
 * claims them, publishes them and records what happened. Nothing here talks to Redis — the relay does that
 * and reports back, so this stays a set of queries.
 */

import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { flowRunOutbox } from "./schema";

export type OutboxEntry = {
  id: string;
  tenantId: string;
  runId: string;
  topic: string;
  payload: unknown;
  attempts: number;
};

/**
 * Claims a batch of unpublished rows for this relay and nobody else.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes more than one worker safe: each transaction takes rows the others
 * have not locked and skips past the rest, instead of every replica queueing behind the same head of the
 * table. Without `SKIP LOCKED` a second relay would block until the first committed, turning horizontal
 * scaling into a serial queue.
 *
 * The rows are marked as attempted inside the same transaction that claims them, so a relay that crashes
 * mid-publish leaves a bounded attempt count rather than an invisible row it will retry forever.
 */
export async function claimOutboxBatch(db: Database, limit: number, maxAttempts: number): Promise<OutboxEntry[]> {
  return await db.transaction(async (tx) => {
    const claimed = await tx
      .select({ id: flowRunOutbox.id })
      .from(flowRunOutbox)
      .where(and(isNull(flowRunOutbox.publishedAt), lt(flowRunOutbox.attempts, maxAttempts)))
      .orderBy(asc(flowRunOutbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (claimed.length === 0) {
      return [];
    }

    const ids = claimed.map((row) => row.id);

    return await tx
      .update(flowRunOutbox)
      .set({ attempts: sql`${flowRunOutbox.attempts} + 1` })
      .where(inIds(ids))
      .returning({
        id: flowRunOutbox.id,
        tenantId: flowRunOutbox.tenantId,
        runId: flowRunOutbox.runId,
        topic: flowRunOutbox.topic,
        payload: flowRunOutbox.payload,
        attempts: flowRunOutbox.attempts,
      });
  });
}

/**
 * Parameterised rather than interpolated, per the no-raw-SQL rule — the ids come from a query rather than
 * from a request, but building SQL by concatenation is a habit worth not having at all.
 */
function inIds(ids: readonly string[]) {
  return sql`${flowRunOutbox.id} in ${ids}`;
}

/** Marks rows as delivered. Called only after the queue has acknowledged them. */
export async function markOutboxPublished(db: Database, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await db.update(flowRunOutbox).set({ publishedAt: new Date(), lastError: null }).where(inIds(ids));
}

/**
 * Records why a publish failed, leaving the row unpublished so the next pass retries it.
 *
 * The message is kept because a row that has stopped retrying is otherwise a silent hole: the run exists, nothing
 * will execute it, and there is nothing to explain why.
 *
 * An empty reason is refused rather than written. A row found at its attempt limit with `last_error` null is
 * undiagnosable — it is the exact state this column exists to prevent — and it is reachable whenever something
 * throws a value with no `message`, so the placeholder is more useful than the null.
 */
export async function markOutboxFailed(db: Database, id: string, message: string): Promise<void> {
  const reason = message.trim().length > 0 ? message : "the publish failed without saying why";

  await db.update(flowRunOutbox).set({ lastError: reason }).where(eq(flowRunOutbox.id, id));
}

/**
 * Gives rows that exhausted their attempts another chance.
 *
 * Without this a stuck row is stuck for good, and the only remedy is hand-written SQL against production — so the
 * relay could report "needs attention" while offering nothing to do about it. The attempt count is reset rather
 * than raised so the row gets a full budget, and `last_error` is kept: what failed last time is the most useful
 * thing to know if it fails again.
 */
export async function resetStuckOutboxRows(db: Database, maxAttempts: number): Promise<number> {
  const reset = await db
    .update(flowRunOutbox)
    .set({ attempts: 0 })
    .where(and(isNull(flowRunOutbox.publishedAt), sql`${flowRunOutbox.attempts} >= ${maxAttempts}`))
    .returning({ id: flowRunOutbox.id });

  return reset.length;
}

/**
 * Rows that have exhausted their attempts — a run that will never be executed unless somebody intervenes.
 *
 * Surfaced deliberately rather than left to be discovered: this is the one failure mode of the outbox
 * pattern that is invisible from the outside, because the run looks queued forever.
 */
export async function countStuckOutboxRows(db: Database, maxAttempts: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flowRunOutbox)
    .where(and(isNull(flowRunOutbox.publishedAt), sql`${flowRunOutbox.attempts} >= ${maxAttempts}`));

  return rows[0]?.count ?? 0;
}

/** Housekeeping: published rows are kept briefly for auditing, then dropped. */
export async function pruneOutboxPublishedBefore(db: Database, cutoff: Date): Promise<void> {
  await db
    .delete(flowRunOutbox)
    .where(and(sql`${flowRunOutbox.publishedAt} is not null`, lt(flowRunOutbox.publishedAt, cutoff)));
}
