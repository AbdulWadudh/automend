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
