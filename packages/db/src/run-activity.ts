/** Runs read across a workspace rather than within one flow — what the run dashboard needs. */

import { buildRetriggerIdempotencyKey, type FlowDefinition, type RunStatusGroup } from "@automend/shared";
import { and, count, desc, eq, max, sql } from "drizzle-orm";
import type { Database } from "./client";
import { type CreatedRun, createFlowRunWithOutbox, type RunSummary, runSummaryColumns } from "./runs";
import { flowRuns, flowStepRuns, flows } from "./schema";

/** What was started from a run — the reverse of `retryOfRunId`, which only the retry itself carries. */
export type RunRetryColumns = {
  retryCount: number;
  latestRetryId: string | null;
  latestRetryStatus: string | null;
};

export type RunListRow = RunSummary &
  RunRetryColumns & {
    flowName: string;
    stepCount: number;
  };

export type ListRunsFilters = {
  flowId?: string;
  status?: string;
  limit: number;
  /** The last run id on the previous page. A keyset cursor, so runs arriving mid-read cannot make
   *  the next page skip one the way an offset would. */
  before?: string;
};

const stepCountColumn = sql<number>`(
  select count(*)::int from ${flowStepRuns} where ${flowStepRuns.runId} = ${flowRuns.id}
)`;

// The alias is written out because this is the same table twice: `${flowRuns}` inside the subquery
// would be indistinguishable from the row being selected.
const retryColumns = {
  retryCount: sql<number>`(
    select count(*)::int from ${flowRuns} as retries where retries.retry_of_run_id = ${flowRuns.id}
  )`,
  latestRetryId: sql<string | null>`(
    select retries.id from ${flowRuns} as retries
    where retries.retry_of_run_id = ${flowRuns.id}
    order by retries.created_at desc limit 1
  )`,
  latestRetryStatus: sql<string | null>`(
    select retries.status from ${flowRuns} as retries
    where retries.retry_of_run_id = ${flowRuns.id}
    order by retries.created_at desc limit 1
  )`,
} as const;

export async function listRunsForTenant(
  db: Database,
  tenantId: string,
  filters: ListRunsFilters,
): Promise<RunListRow[]> {
  const conditions = [eq(flowRuns.tenantId, tenantId)];

  if (filters.flowId) {
    conditions.push(eq(flowRuns.flowId, filters.flowId));
  }

  if (filters.status) {
    conditions.push(eq(flowRuns.status, filters.status));
  }

  if (filters.before) {
    // `(created_at, id)` as a pair: two runs created in the same microsecond would otherwise both
    // sit on the boundary and one would be skipped. The cursor lookup is tenant-scoped so a
    // foreign run id resolves to nothing rather than revealing where it sits in time.
    conditions.push(
      sql`(${flowRuns.createdAt}, ${flowRuns.id}) < (
        select ${flowRuns.createdAt}, ${flowRuns.id} from ${flowRuns}
        where ${flowRuns.id} = ${filters.before} and ${flowRuns.tenantId} = ${tenantId}
      )`,
    );
  }

  return await db
    .select({ ...runSummaryColumns, ...retryColumns, flowName: flows.name, stepCount: stepCountColumn })
    .from(flowRuns)
    .innerJoin(flows, eq(flows.id, flowRuns.flowId))
    .where(and(...conditions))
    .orderBy(desc(flowRuns.createdAt), desc(flowRuns.id))
    .limit(filters.limit);
}

export type RunWithFlow = RunSummary & RunRetryColumns & { flowName: string };

export async function findRunWithFlowForTenant(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<RunWithFlow | undefined> {
  const rows = await db
    .select({ ...runSummaryColumns, ...retryColumns, flowName: flows.name })
    .from(flowRuns)
    .innerJoin(flows, eq(flows.id, flowRuns.flowId))
    .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
    .limit(1);

  return rows[0];
}

export type RunStatusGroupRow = Omit<RunStatusGroup, "lastRunAt"> & { lastRunAt: Date | null };

// `float8` rather than the `numeric` `extract(epoch …)` produces: node-postgres returns `numeric`
// as a string, which becomes NaN two layers up instead of an error anybody can see.
const durationMsExpression = sql`extract(epoch from (${flowRuns.finishedAt} - ${flowRuns.startedAt})) * 1000`;

/**
 * Grouped by status rather than pivoted into a column per status, so no run status is written into
 * SQL — the list lives in `config.runs.statuses`, and `summariseRunGroups` does the pivot.
 */
export async function summariseRunsForTenant(
  db: Database,
  tenantId: string,
  since: Date,
): Promise<RunStatusGroupRow[]> {
  return await db
    .select({
      flowId: flowRuns.flowId,
      flowName: flows.name,
      status: flowRuns.status,
      runCount: count(),
      finishedCount: sql<number>`count(*) filter (where ${flowRuns.finishedAt} is not null and ${flowRuns.startedAt} is not null)::int`,
      totalDurationMs: sql<number>`coalesce(sum(${durationMsExpression}), 0)::float8`,
      longestDurationMs: sql<number | null>`max(${durationMsExpression})::float8`,
      // Drizzle's own `max`, not a raw `sql` one: the driver returns timestamps as strings and lets
      // the column mapper make the Date, which a raw expression has no column to consult.
      lastRunAt: max(flowRuns.createdAt),
    })
    .from(flowRuns)
    .innerJoin(flows, eq(flows.id, flowRuns.flowId))
    .where(and(eq(flowRuns.tenantId, tenantId), sql`${flowRuns.createdAt} >= ${since}`))
    .groupBy(flowRuns.flowId, flows.name, flowRuns.status);
}

export type RetriggerRunValues = {
  tenantId: string;
  sourceRunId: string;
  flowId: string;
  /** One press of the button, named by the caller. See `buildRetriggerIdempotencyKey`. */
  gestureToken: string;
  /** The flow **as it is now**, not the snapshot that failed: somebody retriggers because they just
   *  fixed what broke, so replaying the failed definition would fail the same way. */
  definitionSnapshot: FlowDefinition;
  triggerPayload: unknown;
};

export async function retriggerRun(db: Database, values: RetriggerRunValues): Promise<CreatedRun> {
  return await createFlowRunWithOutbox(db, {
    tenantId: values.tenantId,
    flowId: values.flowId,
    source: "manual",
    idempotencyKey: buildRetriggerIdempotencyKey(values.sourceRunId, values.gestureToken),
    definitionSnapshot: values.definitionSnapshot,
    triggerPayload: values.triggerPayload,
    retryOfRunId: values.sourceRunId,
  });
}
