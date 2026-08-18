/** The activity feed and the summary the run dashboard reads — reports *about* runs, not a run's own shape. */

import { z } from "zod";
import { config } from "./config";
import { flowRunSchema, RUN_STATUSES, runRetrySummarySchema } from "./runs";

const { dashboard } = config.runs;

// Durations are absent from every shape here on purpose: `finishedAt - startedAt` is already on the
// wire and `runDurationMs` derives it identically on both sides.
export const runListItemSchema = flowRunSchema.extend({
  flowName: z.string(),
  stepCount: z.number().int().nonnegative(),
  retries: runRetrySummarySchema,
});

export type RunListItem = z.infer<typeof runListItemSchema>;

export const runListSchema = z.array(runListItemSchema);

export const runListQuerySchema = z.object({
  flowId: z.uuid().optional(),
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(dashboard.maxPageSize).default(dashboard.pageSize),
  /** The last run id on the previous page — a keyset cursor, not an offset. */
  before: z.uuid().optional(),
});

export type RunListQuery = z.infer<typeof runListQuerySchema>;

/** Every status is present, zero included, so a caller reads `byStatus.failed` without a fallback. */
export const runStatusCountsSchema = z.record(z.enum(RUN_STATUSES), z.number().int().nonnegative());

export type RunStatusCounts = z.infer<typeof runStatusCountsSchema>;

export const flowRunStatsSchema = z.object({
  flowId: z.uuid(),
  flowName: z.string(),
  total: z.number().int().nonnegative(),
  byStatus: runStatusCountsSchema,
  averageDurationMs: z.number().nonnegative().nullable(),
  longestDurationMs: z.number().nonnegative().nullable(),
  lastRunAt: z.iso.datetime().nullable(),
});

export type FlowRunStats = z.infer<typeof flowRunStatsSchema>;

export const runStatsSchema = z.object({
  windowHours: z.number().int().positive(),
  since: z.iso.datetime(),
  totals: z.object({
    total: z.number().int().nonnegative(),
    byStatus: runStatusCountsSchema,
    averageDurationMs: z.number().nonnegative().nullable(),
    longestDurationMs: z.number().nonnegative().nullable(),
  }),
  flows: z.array(flowRunStatsSchema),
});

export type RunStats = z.infer<typeof runStatsSchema>;

export const runStatsQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .positive()
    .max(dashboard.maxStatsWindowHours)
    .default(dashboard.defaultStatsWindowHours),
});

export type RunStatsQuery = z.infer<typeof runStatsQuerySchema>;

/** One `(flow, status)` group as the database counts them, stated without reference to Drizzle. */
export type RunStatusGroup = {
  flowId: string;
  flowName: string;
  status: string;
  runCount: number;
  /** Runs in the group that both started and finished — the only ones a duration exists for. */
  finishedCount: number;
  totalDurationMs: number;
  longestDurationMs: number | null;
  lastRunAt: string | null;
};

function emptyStatusCounts(): RunStatusCounts {
  return Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as RunStatusCounts;
}

function isKnownStatus(status: string): status is (typeof RUN_STATUSES)[number] {
  return (RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Averages are weighted by how many runs each group finished, which is why the query returns a sum
 * and a count rather than an average: a flow's single cancelled run must not drag its mean level
 * with a hundred successes.
 */
export function summariseRunGroups(
  groups: readonly RunStatusGroup[],
  window: { windowHours: number; since: string },
): RunStats {
  const perFlow = new Map<string, FlowRunStats & { finishedCount: number; totalDurationMs: number }>();

  let totalFinishedCount = 0;
  let totalDurationMs = 0;
  let longestOverallMs: number | null = null;
  let total = 0;
  const overallByStatus = emptyStatusCounts();

  for (const group of groups) {
    const flow = perFlow.get(group.flowId) ?? {
      flowId: group.flowId,
      flowName: group.flowName,
      total: 0,
      byStatus: emptyStatusCounts(),
      averageDurationMs: null,
      longestDurationMs: null,
      lastRunAt: null,
      finishedCount: 0,
      totalDurationMs: 0,
    };

    flow.total += group.runCount;
    flow.finishedCount += group.finishedCount;
    flow.totalDurationMs += group.totalDurationMs;
    total += group.runCount;
    totalFinishedCount += group.finishedCount;
    totalDurationMs += group.totalDurationMs;

    if (isKnownStatus(group.status)) {
      flow.byStatus[group.status] += group.runCount;
      overallByStatus[group.status] += group.runCount;
    }

    if (group.longestDurationMs !== null) {
      flow.longestDurationMs = Math.max(flow.longestDurationMs ?? 0, group.longestDurationMs);
      longestOverallMs = Math.max(longestOverallMs ?? 0, group.longestDurationMs);
    }

    if (group.lastRunAt && (!flow.lastRunAt || Date.parse(group.lastRunAt) > Date.parse(flow.lastRunAt))) {
      flow.lastRunAt = group.lastRunAt;
    }

    perFlow.set(group.flowId, flow);
  }

  const flows = [...perFlow.values()]
    .map(({ finishedCount, totalDurationMs: flowDurationMs, ...flow }) => ({
      ...flow,
      averageDurationMs: finishedCount > 0 ? flowDurationMs / finishedCount : null,
    }))
    // Name breaks the tie so the order is stable between refetches.
    .sort((left, right) => right.total - left.total || left.flowName.localeCompare(right.flowName));

  return {
    windowHours: window.windowHours,
    since: window.since,
    totals: {
      total,
      byStatus: overallByStatus,
      averageDurationMs: totalFinishedCount > 0 ? totalDurationMs / totalFinishedCount : null,
      longestDurationMs: longestOverallMs,
    },
    flows,
  };
}

export function hasRunInFlight(runs: readonly { status: string }[]): boolean {
  const terminal = new Set<string>(config.runs.terminalStatuses);

  return runs.some((run) => !terminal.has(run.status));
}
