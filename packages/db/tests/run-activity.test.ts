import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { eq } from "drizzle-orm";
import { findRunWithFlowForTenant, listRunsForTenant, retriggerRun, summariseRunsForTenant } from "../src/run-activity";
import { createFlowRunWithOutbox } from "../src/runs";
import { flowRunOutbox, flowRuns, flows } from "../src/schema";
import { claimStepRun } from "../src/step-runs";
import { databaseUrl, setupDatabase, stubDefinition, type TestDatabase } from "./support/database";

/**
 * Against a real Postgres, like `runs.test.ts` and for the same reason: the retrigger key's whole job is
 * to make one press of the button one run, and only the unique index can decide that.
 */

const hasDatabase = databaseUrl() !== undefined;
const describeWithDatabase = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn("Skipping run dashboard tests: DATABASE_URL is not set. Run `bun run dev:up` for a database.");
}

describeWithDatabase("retriggering a run", () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await setupDatabase();
  });

  afterAll(async () => {
    await context?.close();
  });

  async function createFailedRun(payload: unknown = { orderId: "A-1024" }) {
    const created = await createFlowRunWithOutbox(context.db, {
      tenantId: context.tenantId,
      flowId: context.flowId,
      source: "webhook",
      idempotencyKey: `source-${crypto.randomUUID()}`,
      definitionSnapshot: stubDefinition(),
      triggerPayload: payload,
    });

    await context.db
      .update(flowRuns)
      .set({ status: "failed", startedAt: new Date(), finishedAt: new Date() })
      .where(eq(flowRuns.id, created.id));

    return created.id;
  }

  function retriggerValues(sourceRunId: string, gestureToken: string, triggerPayload: unknown = null) {
    return {
      tenantId: context.tenantId,
      sourceRunId,
      gestureToken,
      flowId: context.flowId,
      definitionSnapshot: stubDefinition(),
      triggerPayload,
    };
  }

  test("it starts a new run carrying the original's data, and records where it came from", async () => {
    const sourceRunId = await createFailedRun({ orderId: "A-2048" });
    const retry = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-1", { orderId: "A-2048" }));

    expect(retry.isNew).toBe(true);
    expect(retry.id).not.toBe(sourceRunId);

    const stored = await findRunWithFlowForTenant(context.db, context.tenantId, retry.id);

    expect(stored?.retryOfRunId).toBe(sourceRunId);
    expect(stored?.triggerPayload).toEqual({ orderId: "A-2048" });
    expect(stored?.source).toBe("manual");
  });

  test("the failed run is left exactly as it was, because it is the evidence", async () => {
    const sourceRunId = await createFailedRun();

    await retriggerRun(context.db, retriggerValues(sourceRunId, "press-1"));

    const source = await findRunWithFlowForTenant(context.db, context.tenantId, sourceRunId);

    expect(source?.status).toBe("failed");
    expect(source?.retryOfRunId).toBeNull();
  });

  /** The one that matters: a double-submitted button must not send the email twice. */
  test("five submits of one press produce one run and one job", async () => {
    const sourceRunId = await createFailedRun();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => retriggerRun(context.db, retriggerValues(sourceRunId, "one-press"))),
    );

    const ids = new Set(results.map((result) => result.id));

    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.isNew)).toHaveLength(1);

    const queued = await context.db
      .select()
      .from(flowRunOutbox)
      .where(eq(flowRunOutbox.runId, results[0]?.id ?? ""));

    expect(queued).toHaveLength(1);
  });

  test("a second press is a genuinely new run", async () => {
    const sourceRunId = await createFailedRun();

    const first = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-1"));
    const second = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-2"));

    expect(second.id).not.toBe(first.id);
    expect(second.isNew).toBe(true);

    const lineage = await context.db
      .select({ id: flowRuns.id })
      .from(flowRuns)
      .where(eq(flowRuns.retryOfRunId, sourceRunId));

    expect(lineage).toHaveLength(2);
  });

  /**
   * The reverse of `retryOfRunId`, and the reason it is needed: without it a failure that has already
   * been dealt with is indistinguishable from one nobody has touched.
   */
  test("the source run reports what was started from it", async () => {
    const sourceRunId = await createFailedRun();

    const before = await findRunWithFlowForTenant(context.db, context.tenantId, sourceRunId);

    expect(before?.retryCount).toBe(0);
    expect(before?.latestRetryId).toBeNull();
    expect(before?.latestRetryStatus).toBeNull();

    const first = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-1"));
    const second = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-2"));

    const after = await findRunWithFlowForTenant(context.db, context.tenantId, sourceRunId);

    expect(after?.retryCount).toBe(2);
    expect([first.id, second.id]).toContain(after?.latestRetryId ?? "");
    expect(after?.latestRetryStatus).toBe(config.runs.initialStatus);
  });

  test("a retry does not count itself as its own retry", async () => {
    const sourceRunId = await createFailedRun();
    const retry = await retriggerRun(context.db, retriggerValues(sourceRunId, "press-1"));

    const stored = await findRunWithFlowForTenant(context.db, context.tenantId, retry.id);

    expect(stored?.retryOfRunId).toBe(sourceRunId);
    expect(stored?.retryCount).toBe(0);
  });

  test("another workspace cannot reach this run at all", async () => {
    const sourceRunId = await createFailedRun();
    const stranger = await setupDatabase();

    try {
      expect(await findRunWithFlowForTenant(context.db, stranger.tenantId, sourceRunId)).toBeUndefined();
    } finally {
      await stranger.close();
    }
  });
});

describeWithDatabase("reading a workspace's runs", () => {
  let context: TestDatabase;
  let otherFlowId: string;

  beforeAll(async () => {
    context = await setupDatabase();

    const [otherFlow] = await context.db
      .insert(flows)
      .values({ tenantId: context.tenantId, name: "Second flow", definition: stubDefinition() })
      .returning({ id: flows.id });

    otherFlowId = otherFlow?.id ?? "";
  });

  afterAll(async () => {
    await context?.close();
  });

  async function insertRun(values: {
    flowId?: string;
    status: string;
    createdAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
  }) {
    const [row] = await context.db
      .insert(flowRuns)
      .values({
        tenantId: context.tenantId,
        flowId: values.flowId ?? context.flowId,
        status: values.status,
        source: "webhook",
        idempotencyKey: `listing-${crypto.randomUUID()}`,
        definitionSnapshot: stubDefinition(),
        triggerPayload: null,
        createdAt: values.createdAt,
        startedAt: values.startedAt ?? null,
        finishedAt: values.finishedAt ?? null,
      })
      .returning({ id: flowRuns.id });

    return row?.id ?? "";
  }

  const base = Date.parse("2026-08-19T10:00:00.000Z");
  const at = (offsetSeconds: number) => new Date(base + offsetSeconds * 1_000);

  test("it reads across flows, newest first, naming the flow each run belongs to", async () => {
    await insertRun({ status: "succeeded", createdAt: at(0) });
    await insertRun({ flowId: otherFlowId, status: "failed", createdAt: at(10) });

    const runs = await listRunsForTenant(context.db, context.tenantId, { limit: 10 });

    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]?.flowName).toBe("Second flow");
    expect(runs[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(runs[1]?.createdAt.getTime() ?? 0);
  });

  test("a run with no steps counts zero rather than dropping off the page", async () => {
    const runId = await insertRun({ status: "pending", createdAt: at(20) });
    const runs = await listRunsForTenant(context.db, context.tenantId, { limit: 50 });

    expect(runs.find((run) => run.id === runId)?.stepCount).toBe(0);
  });

  test("step attempts are counted, so a retried run reads as having done more work", async () => {
    const runId = await insertRun({ status: "failed", createdAt: at(30) });

    for (const attempt of [1, 2]) {
      await claimStepRun(context.db, {
        tenantId: context.tenantId,
        runId,
        stepId: "5f2b9c14-1111-4111-8111-111111111111",
        stepName: "Send the email",
        kitId: "gmail",
        actionName: "sendEmail",
        attempt,
        input: null,
      });
    }

    const runs = await listRunsForTenant(context.db, context.tenantId, { limit: 50 });

    expect(runs.find((run) => run.id === runId)?.stepCount).toBe(2);
  });

  test("filters narrow to one flow and one outcome", async () => {
    const byFlow = await listRunsForTenant(context.db, context.tenantId, { limit: 50, flowId: otherFlowId });

    expect(byFlow.every((run) => run.flowId === otherFlowId)).toBe(true);

    const byStatus = await listRunsForTenant(context.db, context.tenantId, { limit: 50, status: "pending" });

    expect(byStatus.every((run) => run.status === "pending")).toBe(true);
  });

  /** Runs created in the same microsecond are why the cursor is a pair rather than a timestamp. */
  test("paging past a cursor neither repeats a run nor skips one", async () => {
    const sameInstant = at(100);

    await Promise.all([
      insertRun({ status: "succeeded", createdAt: sameInstant }),
      insertRun({ status: "succeeded", createdAt: sameInstant }),
      insertRun({ status: "succeeded", createdAt: sameInstant }),
    ]);

    const everything = await listRunsForTenant(context.db, context.tenantId, { limit: 100 });
    const firstPage = await listRunsForTenant(context.db, context.tenantId, { limit: 2 });
    const secondPage = await listRunsForTenant(context.db, context.tenantId, {
      limit: 100,
      before: firstPage.at(-1)?.id,
    });

    const paged = [...firstPage, ...secondPage].map((run) => run.id);

    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(everything.map((run) => run.id));
  });

  test("a cursor from another workspace reveals nothing", async () => {
    const stranger = await setupDatabase();

    try {
      const foreign = await createFlowRunWithOutbox(stranger.db, {
        tenantId: stranger.tenantId,
        flowId: stranger.flowId,
        source: "manual",
        idempotencyKey: `foreign-${crypto.randomUUID()}`,
        definitionSnapshot: stubDefinition(),
        triggerPayload: null,
      });

      const runs = await listRunsForTenant(context.db, context.tenantId, { limit: 50, before: foreign.id });

      expect(runs).toEqual([]);
    } finally {
      await stranger.close();
    }
  });
});

describeWithDatabase("summarising a workspace's runs", () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await setupDatabase();

    const started = new Date();
    const finished = new Date(started.getTime() + 2_000);

    await context.db.insert(flowRuns).values([
      {
        tenantId: context.tenantId,
        flowId: context.flowId,
        status: "succeeded",
        source: "manual",
        idempotencyKey: `stats-a-${crypto.randomUUID()}`,
        definitionSnapshot: stubDefinition(),
        triggerPayload: null,
        startedAt: started,
        finishedAt: finished,
      },
      {
        tenantId: context.tenantId,
        flowId: context.flowId,
        status: "failed",
        source: "manual",
        idempotencyKey: `stats-b-${crypto.randomUUID()}`,
        definitionSnapshot: stubDefinition(),
        triggerPayload: null,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 6_000),
      },
      {
        tenantId: context.tenantId,
        flowId: context.flowId,
        status: "running",
        source: "manual",
        idempotencyKey: `stats-c-${crypto.randomUUID()}`,
        definitionSnapshot: stubDefinition(),
        triggerPayload: null,
        startedAt: started,
      },
    ]);
  });

  afterAll(async () => {
    await context?.close();
  });

  test("it counts one group per status, with durations as numbers rather than strings", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1_000);
    const groups = await summariseRunsForTenant(context.db, context.tenantId, since);
    const byStatus = new Map(groups.map((group) => [group.status, group]));

    expect(byStatus.get("succeeded")?.runCount).toBe(1);
    expect(byStatus.get("succeeded")?.totalDurationMs).toBeCloseTo(2_000, 0);
    expect(byStatus.get("failed")?.longestDurationMs).toBeCloseTo(6_000, 0);
    expect(byStatus.get("succeeded")?.flowName).toBe("Test flow");
  });

  /**
   * Drizzle's driver turns off node-postgres' timestamp parsers and maps them per column, so a raw
   * `sql` aggregate over one comes back as a string. That reached the route as `.toISOString is not a
   * function`, which is a 500 rather than anything a reader could diagnose.
   */
  test("the last run is a Date, not the string the driver would hand back", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1_000);
    const groups = await summariseRunsForTenant(context.db, context.tenantId, since);

    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      expect(group.lastRunAt).toBeInstanceOf(Date);
    }
  });

  test("a run still going contributes no duration, only a count", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1_000);
    const groups = await summariseRunsForTenant(context.db, context.tenantId, since);
    const running = groups.find((group) => group.status === "running");

    expect(running?.runCount).toBe(1);
    expect(running?.finishedCount).toBe(0);
    expect(running?.totalDurationMs).toBe(0);
    expect(running?.longestDurationMs).toBeNull();
  });

  test("the window is a cut-off, not a suggestion", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1_000);

    expect(await summariseRunsForTenant(context.db, context.tenantId, future)).toEqual([]);
  });
});
