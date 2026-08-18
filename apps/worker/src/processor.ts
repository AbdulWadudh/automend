/**
 * The `flow-executions` job handler: one job, one run.
 *
 * What it does, in order, and why the order is the order:
 *
 * 1. **Parse the payload.** It crossed a process boundary through Redis, so it is untrusted input.
 * 2. **Claim the run.** `startFlowRun` moves it from `pending` to `running` only if nothing else has. Two workers
 *    handed the same job — which BullMQ permits after a stalled-job timeout — cannot both proceed.
 * 3. **Validate the snapshot against the registry.** Not redundant with the check the API did on save: the run
 *    executes the definition *as it was*, and a kit may have been removed between the save and a retry an hour
 *    later.
 * 4. **Resolve every credential.** Up front, so a run that cannot get one fails before doing half its work.
 * 5. **Spawn the engine and walk the flow.**
 * 6. **Settle the run**, whatever happened, including if the engine died.
 *
 * An uncaught error never reaches BullMQ from here without the run being recorded first. A job that fails leaving
 * a run stuck in `running` is a row nobody can interpret, and it is what the `finally` below exists to prevent.
 */

import { findRunForExecution, finishFlowRun, nextAttemptForRun, startFlowRun } from "@automend/db";
import {
  describeDefinitionIssues,
  findStepsMissingConnections,
  validateDefinitionAgainstRegistry,
} from "@automend/kits";
import {
  API_ERROR_CODES,
  type FlowExecutionJob,
  type FlowExecutionResult,
  flowExecutionJobSchema,
  type RunError,
} from "@automend/shared";
import { type Job, UnrecoverableError } from "bullmq";
import { resolveRunCredentials } from "./credentials";
import type { WorkerDependencies } from "./dependencies";
import { executeFlow } from "./engine/executor";
import { buildEngineLimits } from "./engine/protocol";
import { createStepHost } from "./engine/step-host";

/**
 * Returns a summary rather than nothing, because that summary is the *only* thing the queue can tell you about a
 * run. BullMQ keeps it as the job's `returnvalue`, which is what the queue dashboard shows — and without it every
 * run, whatever happened inside it, read as an identical `returnValue: null`.
 */
export type FlowExecutionProcessor = (job: Job) => Promise<FlowExecutionResult>;

/**
 * A payload that does not match the schema will never match it on a retry, so it is rejected as unrecoverable
 * instead of burning the job's remaining attempts.
 */
function parseJobPayload(job: Job): FlowExecutionJob {
  const result = flowExecutionJobSchema.safeParse(job.data);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");

    throw new UnrecoverableError(`Invalid flow execution payload — ${problems}`);
  }

  return result.data;
}

function validationError(message: string): RunError {
  return { code: API_ERROR_CODES.FLOW_VALIDATION_FAILED, message, stepId: null };
}

export function createFlowExecutionProcessor(deps: WorkerDependencies): FlowExecutionProcessor {
  const { db, logger } = deps;

  return async function processFlowExecution(job: Job): Promise<FlowExecutionResult> {
    const payload = parseJobPayload(job);
    const runId = payload.executionId;

    const existing = await findRunForExecution(db, runId);

    if (!existing) {
      // The flow was deleted, which cascaded the run away. Nothing to do and nothing wrong — a retry would find
      // the same absence, so the job is finished rather than failed.
      logger.info({ runId }, "run no longer exists, nothing to execute");

      return { runId, status: "skipped", reason: "the run no longer exists" };
    }

    if (existing.status !== "pending") {
      // Already claimed, already finished, or already abandoned. Re-running it would duplicate side effects, which
      // is the one thing this whole design exists to prevent.
      logger.info({ runId, status: existing.status }, "run is not pending, leaving it alone");

      return { runId, status: "skipped", reason: `the run is already ${existing.status}` };
    }

    const claimed = await startFlowRun(db, runId);

    if (!claimed) {
      // Somebody else claimed it between the read above and this update — the honest outcome of a race, and the
      // reason the claim is a conditional update rather than a read followed by a write.
      logger.info({ runId }, "another worker claimed this run");

      return { runId, status: "skipped", reason: "another worker claimed this run" };
    }

    const definition = claimed.definitionSnapshot;

    const issues = validateDefinitionAgainstRegistry(definition);

    if (issues.length > 0) {
      await finishFlowRun(db, runId, {
        status: "failed",
        error: validationError(`This flow can no longer run — ${describeDefinitionIssues(issues)}`),
      });
      logger.warn({ runId, issues: issues.length }, "run failed: its definition no longer validates");

      return { runId, status: "failed", reason: describeDefinitionIssues(issues) };
    }

    const missing = findStepsMissingConnections(definition);

    if (missing.length > 0) {
      // Saveable but not runnable, which is a distinction the builder makes on purpose. The run is where it
      // becomes a failure.
      await finishFlowRun(db, runId, {
        status: "failed",
        error: validationError(describeDefinitionIssues(missing)),
      });
      logger.warn({ runId }, "run failed: a step has no connection");

      return { runId, status: "failed", reason: describeDefinitionIssues(missing) };
    }

    const credentials = await resolveRunCredentials({
      db,
      auth: deps.auth,
      secretsKey: deps.secretsKey,
      tenantId: existing.tenantId,
      definition,
    });

    if (!credentials.ok) {
      await finishFlowRun(db, runId, {
        status: "failed",
        error: {
          code: API_ERROR_CODES.STEP_EXECUTION_FAILED,
          message: credentials.message,
          stepId: credentials.stepId,
        },
      });
      // The reason, not just that there was one. It is persisted on the run for the UI to show, but a
      // log line without it means the telemetry backend records that a run failed and nothing about why
      // — which is the one question anybody searching for it has.
      logger.warn(
        {
          runId,
          flowId: existing.flowId,
          stepId: credentials.stepId,
          step: credentials.stepName,
          reason: credentials.message,
        },
        "run failed: a credential could not be resolved",
      );

      return {
        runId,
        status: "failed",
        reason: credentials.message,
        stepId: credentials.stepId,
        steps: definition.steps.length,
      };
    }

    const run = {
      id: runId,
      flowId: existing.flowId,
      tenantId: existing.tenantId,
      idempotencyKey: payload.idempotencyKey,
    };

    // Derived from the journal rather than from BullMQ's `attemptsMade`, because the two can disagree: a job can be
    // handed to a second worker after a stall without its attempt count moving.
    const attempt = await nextAttemptForRun(db, runId);
    const host = createStepHost({ run, limits: buildEngineLimits(deps.allowPrivateNetwork), logger });

    logger.info({ runId, flowId: run.flowId, attempt, steps: definition.steps.length }, "executing flow");

    try {
      const outcome = await executeFlow({
        db,
        run,
        definition,
        triggerPayload: claimed.triggerPayload,
        attempt,
        host,
        credentials: credentials.credentials,
        logger,
      });

      await finishFlowRun(db, runId, outcome);

      logger.info({ runId, status: outcome.status, attempt }, "flow finished");

      // Rethrown *after* the run is settled, so BullMQ retries a failed run while the journal already records why
      // it failed. Without this a failure would look like a success to the queue.
      if (outcome.status === "failed") {
        throw new Error(outcome.error?.message ?? "the flow failed");
      }

      return { runId, status: "succeeded", steps: definition.steps.length };
    } catch (error) {
      // Only reached for something the executor did not already record — the engine dying, or the database going
      // away mid-run. Settling here means a run is never left in `running` with nothing to explain it.
      const settled = await finishFlowRun(db, runId, {
        status: "failed",
        error: { code: API_ERROR_CODES.STEP_EXECUTION_FAILED, message: (error as Error).message, stepId: null },
      });

      if (settled) {
        logger.error({ err: error, runId }, "flow execution failed outside a step");
      }

      throw error;
    } finally {
      // Always, so a finished run leaves no subprocess behind — including on the throw above.
      await host.close();
    }
  };
}
