/**
 * Draining `flow_run_outbox` onto the queue.
 *
 * The other half of the transactional outbox. Whoever creates a run writes the run and the intent to execute it in
 * one transaction; this is what turns that intent into a BullMQ job. Between the two, the guarantee is: a run that
 * exists will be enqueued, and a transaction that rolled back enqueued nothing.
 *
 * An interval rather than a `LISTEN`. A row can be committed by any API replica, and polling one small partial
 * index every second is cheaper than every replica holding a listener connection open. The latency it adds is
 * bounded by the interval and applies to *starting* a run rather than to running one.
 *
 * Ordering is deliberate and the only version that is safe: publish first, then mark published. A crash between
 * the two re-publishes the job, and BullMQ's own job id makes that a no-op — whereas marking first and crashing
 * would lose the run entirely, with nothing left to say it was ever meant to happen.
 */

import {
  claimOutboxBatch,
  countStuckOutboxRows,
  type Database,
  markOutboxFailed,
  markOutboxPublished,
} from "@automend/db";
import { config, flowExecutionJobSchema } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import type { Queue } from "bullmq";

/**
 * A thrown value as a sentence.
 *
 * A `catch` receives whatever was thrown, which need not be an `Error` — a rejected `fetch`, a library throwing a
 * string, a `null`. Reading `.message` off those gives `undefined`, and storing that loses the only record of why
 * a run will never execute.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  const described = String(error);

  return described === "[object Object]" ? "an unrecognised failure" : described;
}

export type OutboxRelay = {
  /** Runs one pass. Exposed so a test can drive it without waiting for the interval. */
  drainOnce: () => Promise<number>;
  stop: () => void;
};

export type CreateOutboxRelayOptions = {
  db: Database;
  queue: Queue;
  logger: Logger;
};

export function createOutboxRelay({ db, queue, logger }: CreateOutboxRelayOptions): OutboxRelay {
  const { outbox, queue: queueConfig, runs } = config;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Guards against a slow pass overlapping the next tick and claiming rows twice over. */
  let draining = false;

  async function publish(entry: Awaited<ReturnType<typeof claimOutboxBatch>>[number]): Promise<boolean> {
    // Parsed rather than trusted: the payload was written by another process into a `jsonb` column, so it is
    // untrusted input like any other — and a malformed one must not become a job the worker cannot parse either.
    const parsed = flowExecutionJobSchema.safeParse(entry.payload);

    if (!parsed.success) {
      await markOutboxFailed(db, entry.id, `the queued payload is not a valid flow execution job`);
      logger.error({ outboxId: entry.id, runId: entry.runId }, "outbox row holds an unusable payload");

      return false;
    }

    try {
      await queue.add(queueConfig.flowExecutions.jobName, parsed.data, {
        // The run's own id, so a re-publish after a crash between the two writes below is a no-op rather than a
        // second execution. This is what makes "publish, then mark" safe.
        jobId: parsed.data.executionId,
        attempts: runs.retry.attempts,
        backoff: { type: "exponential", delay: runs.retry.backoffMs },
        removeOnComplete: true,
        removeOnFail: false,
      });

      return true;
    } catch (error) {
      // Left unpublished, so the next pass retries it. The reason is kept because a row that has stopped retrying
      // is otherwise a silent hole: the run exists, looks queued, and nothing will ever execute it.
      //
      // `describeFailure` rather than `error.message` because a thrown value need not be an `Error` — and reading
      // `.message` off something that is not one records `null`, producing precisely the undiagnosable row this
      // column exists to prevent.
      await markOutboxFailed(db, entry.id, describeFailure(error));
      logger.warn({ err: error, outboxId: entry.id, runId: entry.runId }, "could not queue a run");

      return false;
    }
  }

  async function drainOnce(): Promise<number> {
    const claimed = await claimOutboxBatch(db, outbox.batchSize, outbox.maxAttempts);

    if (claimed.length === 0) {
      return 0;
    }

    const published: string[] = [];

    for (const entry of claimed) {
      // Each entry is isolated. `claimOutboxBatch` has already spent an attempt on every row in the batch, so an
      // unexpected throw escaping this loop would abandon the rest of them with an attempt spent and no reason
      // recorded — which is how a row reaches its limit with `last_error` null and nothing to explain it.
      try {
        if (await publish(entry)) {
          published.push(entry.id);
        }
      } catch (error) {
        await markOutboxFailed(db, entry.id, describeFailure(error));
        logger.error({ err: error, outboxId: entry.id, runId: entry.runId }, "publishing a run threw unexpectedly");
      }
    }

    await markOutboxPublished(db, published);

    if (published.length > 0) {
      logger.info({ published: published.length, claimed: claimed.length }, "queued runs from the outbox");
    }

    return published.length;
  }

  async function tick(): Promise<void> {
    if (draining) {
      return;
    }

    draining = true;

    try {
      await drainOnce();

      const stuck = await countStuckOutboxRows(db, outbox.maxAttempts);

      if (stuck > 0) {
        // Reported every pass rather than once, because this is the failure mode of the outbox pattern that is
        // invisible from the outside — the runs exist, they look queued, and nothing will execute them. The
        // remedy is named, because "needs attention" with nothing to do about it is not a useful alert.
        logger.error(
          { stuck, maxAttempts: outbox.maxAttempts },
          "runs are stuck in the outbox and will not be retried — see last_error on flow_run_outbox, then call resetStuckOutboxRows",
        );
      }
    } catch (error) {
      // Swallowed after logging: an unhandled rejection here would take the worker down and stop it processing the
      // jobs it has already been given, which is a worse outcome than a missed pass.
      logger.error({ err: error }, "outbox relay pass failed");
    } finally {
      draining = false;
    }
  }

  timer = setInterval(() => void tick(), outbox.relayIntervalMs);
  // Drained immediately as well, so a worker starting up picks up whatever accumulated while it was down.
  void tick();

  return {
    drainOnce,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
