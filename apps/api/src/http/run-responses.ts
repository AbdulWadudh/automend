/** Shared by the flows router and the runs router, so both describe a run identically. */

import type { RunListRow, RunRetryColumns, RunSummary, RunWithFlow, StepRunSummary } from "@automend/db";
import type {
  FlowRun,
  FlowRunDetail,
  FlowStepRun,
  RunListItem,
  RunRetrySummary,
  RunStatus,
  StepStatus,
} from "@automend/shared";

// The status columns are `text`, not a pg enum, so the cast here undoes that widening. Safe for the
// same reason the column is text: nothing writes a status outside `config.runs.statuses`.
export function toRunResponse(row: RunSummary): FlowRun {
  return {
    id: row.id,
    tenantId: row.tenantId,
    flowId: row.flowId,
    status: row.status as RunStatus,
    source: row.source as FlowRun["source"],
    idempotencyKey: row.idempotencyKey,
    triggerPayload: row.triggerPayload,
    error: row.error,
    retryOfRunId: row.retryOfRunId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRetrySummary(row: RunRetryColumns): RunRetrySummary {
  return {
    count: row.retryCount,
    latestRunId: row.latestRetryId,
    latestStatus: (row.latestRetryStatus as RunStatus | null) ?? null,
  };
}

export function toRunListItemResponse(row: RunListRow): RunListItem {
  return {
    ...toRunResponse(row),
    flowName: row.flowName,
    stepCount: row.stepCount,
    retries: toRetrySummary(row),
  };
}

export function toStepRunResponse(row: StepRunSummary): FlowStepRun {
  return {
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    stepName: row.stepName,
    kitId: row.kitId,
    actionName: row.actionName,
    status: row.status as StepStatus,
    attempt: row.attempt,
    input: row.input,
    output: row.output,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function toRunDetailResponse(row: RunWithFlow, steps: StepRunSummary[]): FlowRunDetail {
  return {
    ...toRunResponse(row),
    flowName: row.flowName,
    retries: toRetrySummary(row),
    steps: steps.map(toStepRunResponse),
  };
}
