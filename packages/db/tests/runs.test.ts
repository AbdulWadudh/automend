import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { and, eq, isNull } from "drizzle-orm";
import {
  claimOutboxBatch,
  countStuckOutboxRows,
  markOutboxFailed,
  markOutboxPublished,
  resetStuckOutboxRows,
} from "../src/outbox";
import { abandonPendingRun, createFlowRunWithOutbox, finishFlowRun, listRunsForFlow, startFlowRun } from "../src/runs";
import { flowRunOutbox, flows } from "../src/schema";
import { claimStepRun, completeStepRun, findSucceededStepOutputs, nextAttemptForRun } from "../src/step-runs";
import { databaseUrl, setupDatabase, stubDefinition, type TestDatabase } from "./support/database";

/**
 * Against a real Postgres, because every guarantee below is Postgres behaviour rather than ours.
 *
 * These cover the two non-negotiables that cannot be tested any other way: a retried trigger produces one run,
 * and a retried job does not repeat a step's side effect. Both are decided by `ON CONFLICT` inside the
 * database precisely because a read-then-write in application code races with the retry it exists to stop —
 * so the tests fire callers *concurrently* rather than in sequence, which is the only version that proves it.
 */

const hasDatabase = databaseUrl() !== undefined;
const describeWithDatabase = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn("Skipping run persistence tests: DATABASE_URL is not set. Run `bun run dev:up` for a database.");
}

describeWithDatabase("run persistence", () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await setupDatabase();
  });

  afterAll(async () => {
    await context?.close();
  });

  function runValues(idempotencyKey: string) {
    return {
      tenantId: context.tenantId,
      flowId: context.flowId,
      source: "webhook" as const,
      idempotencyKey,
      definitionSnapshot: stubDefinition(),
      triggerPayload: { orderId: "A-1024" },
    };
  }

  describe("creating a run", () => {
    test("records it as new, pending, and queues exactly one outbox row", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`new-${crypto.randomUUID()}`));

      expect(created.isNew).toBe(true);
      expect(created.status).toBe(config.runs.initialStatus);

      const queued = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(queued).toHaveLength(1);
      expect(queued[0]?.topic).toBe(config.queue.flowExecutions.name);
      expect(queued[0]?.publishedAt).toBeNull();
    });

    test("a replayed key resolves to the run that exists rather than a second one", async () => {
      const key = `replay-${crypto.randomUUID()}`;

      const first = await createFlowRunWithOutbox(context.db, runValues(key));
      const second = await createFlowRunWithOutbox(context.db, runValues(key));

      expect(second.id).toBe(first.id);
      expect(second.isNew).toBe(false);
    });

    /**
     * The one that matters. A read-then-insert would have both callers find nothing and both insert, which is
     * exactly what a sender retrying a webhook two milliseconds later produces.
     */
    test("two callers arriving together produce one run and one job", async () => {
      const key = `race-${crypto.randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 5 }, () => createFlowRunWithOutbox(context.db, runValues(key))),
      );

      const ids = new Set(results.map((result) => result.id));
      const newCount = results.filter((result) => result.isNew).length;

      expect(ids.size).toBe(1);
      // Exactly one caller may believe it created the run — that is what decides who enqueues.
      expect(newCount).toBe(1);

      const runId = results[0]?.id ?? "";
      const queued = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, runId));

      expect(queued).toHaveLength(1);
    });

    test("a repeat queues nothing further, so a replay cannot cause a second execution", async () => {
      const key = `norequeue-${crypto.randomUUID()}`;
      const created = await createFlowRunWithOutbox(context.db, runValues(key));

      await createFlowRunWithOutbox(context.db, runValues(key));
      await createFlowRunWithOutbox(context.db, runValues(key));

      const queued = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(queued).toHaveLength(1);
    });

    test("the same key under a different flow is a different run", async () => {
      const key = `shared-${crypto.randomUUID()}`;
      const [otherFlow] = await context.db
        .insert(flows)
        .values({ tenantId: context.tenantId, name: "Other flow", definition: stubDefinition() })
        .returning({ id: flows.id });

      const first = await createFlowRunWithOutbox(context.db, runValues(key));
      const second = await createFlowRunWithOutbox(context.db, {
        ...runValues(key),
        flowId: otherFlow?.id ?? context.flowId,
      });

      expect(second.id).not.toBe(first.id);
      expect(second.isNew).toBe(true);
    });
  });

  describe("claiming and finishing a run", () => {
    test("the first claim wins and gets the snapshot; a second finds nothing to claim", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`claim-${crypto.randomUUID()}`));

      const first = await startFlowRun(context.db, created.id);
      const second = await startFlowRun(context.db, created.id);

      expect(first?.triggerPayload).toEqual({ orderId: "A-1024" });
      // BullMQ can hand the same job to a second worker after a stall; only one may proceed.
      expect(second).toBeUndefined();
    });

    test("only one of many simultaneous workers claims a run", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`claimrace-${crypto.randomUUID()}`));

      const claims = await Promise.all(Array.from({ length: 5 }, () => startFlowRun(context.db, created.id)));

      expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
    });

    test("a finished run cannot be finished again", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`finish-${crypto.randomUUID()}`));

      await startFlowRun(context.db, created.id);

      expect(await finishFlowRun(context.db, created.id, { status: "succeeded", error: null })).toBe(true);
      // A late result from a subprocess that was already killed must not overwrite the outcome.
      expect(await finishFlowRun(context.db, created.id, { status: "failed", error: null })).toBe(false);
    });

    test("a run that never started cannot be marked succeeded", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`nostart-${crypto.randomUUID()}`));

      expect(await finishFlowRun(context.db, created.id, { status: "succeeded", error: null })).toBe(false);
    });

    /** A flow deleted before the worker collected the job, or a definition that no longer validates. */
    test("a pending run can be abandoned without ever running", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`abandon-${crypto.randomUUID()}`));

      const error = { code: "FLOW_VALIDATION_FAILED", message: "Step names an unknown action", stepId: null };

      expect(await abandonPendingRun(context.db, created.id, { status: "failed", error })).toBe(true);
      expect(await abandonPendingRun(context.db, created.id, { status: "failed", error })).toBe(false);
    });

    test("runs come back newest first, scoped to the workspace", async () => {
      const listed = await listRunsForFlow(context.db, context.tenantId, context.flowId, config.runs.recentRuns);

      expect(listed.length).toBeGreaterThan(0);

      for (const run of listed) {
        expect(run.tenantId).toBe(context.tenantId);
      }

      const timestamps = listed.map((run) => run.createdAt.getTime());

      expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
    });

    test("another workspace cannot read this one's runs", async () => {
      const other = await setupDatabase();

      try {
        expect(await listRunsForFlow(context.db, other.tenantId, context.flowId, 10)).toEqual([]);
      } finally {
        await other.close();
      }
    });
  });

  describe("the step journal", () => {
    const stepId = crypto.randomUUID();

    function stepValues(runId: string, attempt: number, id = stepId) {
      return {
        tenantId: context.tenantId,
        runId,
        stepId: id,
        stepName: "Send the receipt",
        kitId: "gmail",
        actionName: "sendEmail",
        attempt,
        input: { to: "ada@example.com" },
      };
    }

    test("a first claim is granted and records the input before the step runs", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`step-${crypto.randomUUID()}`));
      const claim = await claimStepRun(context.db, stepValues(created.id, 1));

      expect(claim.outcome).toBe("claimed");
    });

    /**
     * The single most important assertion in this file. Two workers handed the same job must not both send
     * the email — so exactly one claim is granted and the other is told the result already exists.
     */
    test("only one of many simultaneous claims on the same attempt is granted", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`steprace-${crypto.randomUUID()}`));

      const claims = await Promise.all(
        Array.from({ length: 5 }, () => claimStepRun(context.db, stepValues(created.id, 1))),
      );

      expect(claims.filter((claim) => claim.outcome === "claimed")).toHaveLength(1);
      expect(claims.filter((claim) => claim.outcome === "alreadyRecorded")).toHaveLength(4);
    });

    test("a completed step reports its recorded output instead of being claimed again", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`replaystep-${crypto.randomUUID()}`));
      const claim = await claimStepRun(context.db, stepValues(created.id, 1));

      if (claim.outcome !== "claimed") {
        throw new Error("expected the first claim to be granted");
      }

      await completeStepRun(context.db, claim.stepRunId, {
        status: "succeeded",
        output: { messageId: "msg-1" },
        error: null,
      });

      const again = await claimStepRun(context.db, stepValues(created.id, 1));

      expect(again.outcome).toBe("alreadyRecorded");

      if (again.outcome === "alreadyRecorded") {
        // This is what a retry replays rather than re-invoking — the email is not sent twice.
        expect(again.status).toBe("succeeded");
        expect(again.output).toEqual({ messageId: "msg-1" });
      }
    });

    test("a completed step cannot be completed again", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`recomplete-${crypto.randomUUID()}`));
      const claim = await claimStepRun(context.db, stepValues(created.id, 1));

      if (claim.outcome !== "claimed") {
        throw new Error("expected the first claim to be granted");
      }

      expect(
        await completeStepRun(context.db, claim.stepRunId, { status: "succeeded", output: null, error: null }),
      ).toBe(true);
      expect(await completeStepRun(context.db, claim.stepRunId, { status: "failed", output: null, error: null })).toBe(
        false,
      );
    });

    /**
     * A retry gets a fresh attempt number rather than overwriting, because discarding the record of a failed
     * attempt discards the only evidence of what went wrong.
     */
    test("a retry claims a new attempt alongside the record of the old one", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`retry-${crypto.randomUUID()}`));

      const first = await claimStepRun(context.db, stepValues(created.id, 1));

      if (first.outcome !== "claimed") {
        throw new Error("expected the first claim to be granted");
      }

      await completeStepRun(context.db, first.stepRunId, {
        status: "failed",
        output: null,
        error: { code: "STEP_EXECUTION_FAILED", message: "Gmail was unreachable", stepId },
      });

      expect(await nextAttemptForRun(context.db, created.id)).toBe(2);

      const second = await claimStepRun(context.db, stepValues(created.id, 2));

      expect(second.outcome).toBe("claimed");
    });

    test("only succeeded outputs are offered for replay", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`outputs-${crypto.randomUUID()}`));
      const okStep = crypto.randomUUID();
      const badStep = crypto.randomUUID();

      const okClaim = await claimStepRun(context.db, stepValues(created.id, 1, okStep));
      const badClaim = await claimStepRun(context.db, stepValues(created.id, 1, badStep));

      if (okClaim.outcome !== "claimed" || badClaim.outcome !== "claimed") {
        throw new Error("expected both claims to be granted");
      }

      await completeStepRun(context.db, okClaim.stepRunId, { status: "succeeded", output: { a: 1 }, error: null });
      await completeStepRun(context.db, badClaim.stepRunId, {
        status: "failed",
        output: { leaked: true },
        error: { code: "STEP_EXECUTION_FAILED", message: "nope", stepId: badStep },
      });

      const outputs = await findSucceededStepOutputs(context.db, created.id);

      expect(outputs.get(okStep)).toEqual({ a: 1 });
      // A failed step's output must not be replayed as though the step had worked.
      expect(outputs.has(badStep)).toBe(false);
    });
  });

  /**
   * Larger than anything these tests write, because `claimOutboxBatch` is global by design — it is the
   * relay, and the relay has no tenant. With the production batch size, unpublished rows left behind by
   * earlier tests can crowd out the row the test just wrote, which fails as an empty id rather than as
   * the volume problem it is.
   */
  const CLAIM_EVERYTHING = 1_000;

  describe("the outbox relay", () => {
    test("claims unpublished rows and counts the attempt", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`outbox-${crypto.randomUUID()}`));

      const claimed = await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      const mine = claimed.find((entry) => entry.runId === created.id);

      expect(mine).toBeDefined();
      expect(mine?.topic).toBe(config.queue.flowExecutions.name);
      expect(mine?.attempts).toBe(1);
    });

    /**
     * `FOR UPDATE SKIP LOCKED` is what lets two relays run at once. Without it the second would block behind
     * the first, turning horizontal scaling into a serial queue — and worse, both could claim the same row.
     */
    test("two relays running together never claim the same row twice", async () => {
      await Promise.all(
        Array.from({ length: 6 }, () => createFlowRunWithOutbox(context.db, runValues(`skip-${crypto.randomUUID()}`))),
      );

      const [left, right] = await Promise.all([
        claimOutboxBatch(context.db, 3, config.outbox.maxAttempts),
        claimOutboxBatch(context.db, 3, config.outbox.maxAttempts),
      ]);

      const ids = [...left.map((entry) => entry.id), ...right.map((entry) => entry.id)];

      expect(new Set(ids).size).toBe(ids.length);
    });

    test("a published row is not claimed again", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`publish-${crypto.randomUUID()}`));
      const claimed = await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      const mine = claimed.find((entry) => entry.runId === created.id);

      await markOutboxPublished(context.db, [mine?.id ?? ""]);

      const unpublished = await context.db
        .select({ id: flowRunOutbox.id })
        .from(flowRunOutbox)
        .where(and(eq(flowRunOutbox.runId, created.id), isNull(flowRunOutbox.publishedAt)));

      expect(unpublished).toEqual([]);
    });

    /**
     * A row that has stopped retrying is the one failure mode of this pattern that is invisible from outside:
     * the run exists, looks queued, and nothing will ever execute it. So the message is kept.
     */
    test("a failed publish keeps its reason and stays unpublished for the next pass", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`fail-${crypto.randomUUID()}`));
      const claimed = await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      const mine = claimed.find((entry) => entry.runId === created.id);

      await markOutboxFailed(context.db, mine?.id ?? "", "Redis was unreachable");

      const [row] = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(row?.publishedAt).toBeNull();
      expect(row?.lastError).toBe("Redis was unreachable");
    });

    test("a row past its attempt limit is left alone rather than retried forever", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`exhaust-${crypto.randomUUID()}`));

      for (let pass = 0; pass < config.outbox.maxAttempts + 2; pass += 1) {
        await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      }

      const [row] = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(row?.attempts).toBe(config.outbox.maxAttempts);
    });

    /**
     * Found in the dev database: two rows at their attempt limit with `last_error` null, which is the exact state
     * the column exists to prevent — a run that will never execute and nothing to say why. Reachable whenever
     * something throws a value with no `message`, since reading `.message` off it stores null.
     */
    test("a failure with no message still records a reason", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`noreason-${crypto.randomUUID()}`));
      const claimed = await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      const mine = claimed.find((entry) => entry.runId === created.id);

      await markOutboxFailed(context.db, mine?.id ?? "", "");

      const [row] = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(row?.lastError).not.toBeNull();
      expect((row?.lastError ?? "").length).toBeGreaterThan(0);
    });

    /**
     * Without a way back, a stuck row is stuck for good and the only remedy is hand-written SQL against production
     * — so the relay would report "needs attention" while offering nothing to do about it.
     */
    test("a stuck row can be given another chance, keeping the reason it failed", async () => {
      const created = await createFlowRunWithOutbox(context.db, runValues(`revive-${crypto.randomUUID()}`));

      for (let pass = 0; pass < config.outbox.maxAttempts + 1; pass += 1) {
        await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);
      }

      const [exhausted] = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      await markOutboxFailed(context.db, exhausted?.id ?? "", "Redis was unreachable");
      expect(await countStuckOutboxRows(context.db, config.outbox.maxAttempts)).toBeGreaterThan(0);

      const revived = await resetStuckOutboxRows(context.db, config.outbox.maxAttempts);

      expect(revived).toBeGreaterThan(0);

      const [row] = await context.db.select().from(flowRunOutbox).where(eq(flowRunOutbox.runId, created.id));

      expect(row?.attempts).toBe(0);
      // Kept: what failed last time is the most useful thing to know if it fails again.
      expect(row?.lastError).toBe("Redis was unreachable");

      // Claimable again, which is the whole point.
      const reclaimed = await claimOutboxBatch(context.db, CLAIM_EVERYTHING, config.outbox.maxAttempts);

      expect(reclaimed.some((entry) => entry.runId === created.id)).toBe(true);
    });
  });
});
