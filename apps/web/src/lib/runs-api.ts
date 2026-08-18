import {
  type FlowRunDetail,
  flowRunDetailSchema,
  type RunListItem,
  type RunListQuery,
  type RunStats,
  runListSchema,
  runStatsSchema,
  type StartedRun,
  startedRunSchema,
} from "@automend/shared";
import { requestApi } from "./api";

const RUNS_PATH = "/runs";

export const runQueryKeys = {
  all: ["runs"] as const,
  list: (filters: RunListFilters) => [...runQueryKeys.all, "list", filters] as const,
  detail: (runId: string) => [...runQueryKeys.all, "detail", runId] as const,
  stats: (windowHours: number) => [...runQueryKeys.all, "stats", windowHours] as const,
};

export type RunListFilters = Pick<RunListQuery, "flowId" | "status">;

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const query = search.toString();

  return query ? `?${query}` : "";
}

export async function listRuns(filters: RunListFilters, before?: string, signal?: AbortSignal): Promise<RunListItem[]> {
  return await requestApi({
    path: `${RUNS_PATH}${buildQuery({ ...filters, before })}`,
    schema: runListSchema,
    signal,
  });
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<FlowRunDetail> {
  return await requestApi({ path: `${RUNS_PATH}/${runId}`, schema: flowRunDetailSchema, signal });
}

export async function getRunStats(windowHours: number, signal?: AbortSignal): Promise<RunStats> {
  return await requestApi({
    path: `${RUNS_PATH}/stats${buildQuery({ windowHours })}`,
    schema: runStatsSchema,
    signal,
  });
}

export async function retriggerRun(runId: string, idempotencyKey: string): Promise<StartedRun> {
  return await requestApi({
    path: `${RUNS_PATH}/${runId}/retrigger`,
    schema: startedRunSchema,
    method: "POST",
    body: { idempotencyKey },
  });
}
