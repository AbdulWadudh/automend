/**
 * Job payload schemas.
 *
 * A job payload crosses a process boundary through Redis, so it is untrusted input like any
 * request body: the worker parses it with these schemas before touching business logic.
 *
 * Queue and job names live in `config.queue` — import them from there.
 */

import { z } from "zod";
import { config } from "./config";

export const flowExecutionJobSchema = z.object({
  executionId: z.uuid(),
  flowId: z.uuid(),
  tenantId: z.uuid(),
  /**
   * Stable across retries of the same execution. The execution engine will use it to make
   * check-then-act on side effects safe inside a single transaction, so a retried job can never
   * fire the same side effect twice.
   */
  idempotencyKey: z
    .string()
    .min(config.validation.idempotencyKey.minLength)
    .max(config.validation.idempotencyKey.maxLength),
  triggeredAt: z.iso.datetime(),
});

export type FlowExecutionJob = z.infer<typeof flowExecutionJobSchema>;

/**
 * What a finished job reports back, and the only thing the queue itself can tell you about a run.
 *
 * BullMQ stores this as the job's `returnvalue`, which is what the queue dashboard shows. It exists because the
 * queue would otherwise say nothing useful: the payload is a *pointer* — one `executionId` — and every run,
 * whatever happened inside it, looked identical to a `returnValue: null`.
 *
 * Deliberately a *summary* and not the data. A step's input, output and error already live in
 * `flow_step_runs`, per step, tenant-scoped, and permanently. Copying them here would put customer data in
 * Redis behind a single cross-tenant operator password, size a job by whatever an HTTP step happened to return,
 * and create a second copy that expires under the queue's retention while the first does not. `runId` is the
 * pointer back to the version that is authoritative.
 */
export type FlowExecutionResult = {
  runId: string;
  /**
   * What the *run* did — which is not always what the *job* did.
   *
   * `skipped` covers the run being gone, already settled, or claimed by another worker. Those are ordinary
   * outcomes of an idempotent queue rather than problems, and a dashboard that cannot tell them apart from a
   * successful execution is a dashboard that misleads.
   */
  status: "succeeded" | "failed" | "skipped";
  /** Why, when `status` is not `succeeded`. Absent otherwise rather than null, so it is obvious when it applies. */
  reason?: string;
  /** The step that failed, when one did — enough to find it in the journal without opening every step. */
  stepId?: string;
  /** How many steps the definition asked for, so "failed" can be read against how far it got. */
  steps?: number;
};
