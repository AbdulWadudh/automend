/**
 * The `flow-executions` job handler.
 *
 * No execution logic yet — this step only proves the transport works end to end. What it does
 * establish is the boundary contract: a job payload arrives from Redis as untrusted input and is
 * parsed with the shared Zod schema before anything else looks at it.
 */

import { type FlowExecutionJob, flowExecutionJobSchema } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import { type Job, UnrecoverableError } from "bullmq";

export type FlowExecutionProcessor = (job: Job) => Promise<void>;

/**
 * A payload that does not match the schema will never match it on a retry, so it is rejected as
 * unrecoverable instead of burning the job's remaining attempts.
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

export function createFlowExecutionProcessor(logger: Logger): FlowExecutionProcessor {
  return async function processFlowExecution(job: Job): Promise<void> {
    try {
      const payload = parseJobPayload(job);

      logger.info(
        {
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          executionId: payload.executionId,
          flowId: payload.flowId,
          tenantId: payload.tenantId,
          idempotencyKey: payload.idempotencyKey,
        },
        "received flow execution job",
      );

      // The execution engine lands here in a later step. Per the platform's non-negotiables it
      // will resolve the idempotency key inside a transaction before any side effect, and run
      // user-authored step code in an isolated subprocess — never in this process.
    } catch (error) {
      logger.error({ err: error, jobId: job.id, jobName: job.name }, "flow execution job failed");
      // Rethrown so BullMQ marks the job failed and applies its retry policy. The worker process
      // itself stays up.
      throw error;
    }
  };
}
