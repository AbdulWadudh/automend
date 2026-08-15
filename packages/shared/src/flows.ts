/**
 * Flow schemas shared by the API, the worker and the web client.
 *
 * Only the persisted shape exists at this stage — the flow definition (trigger, steps, branches)
 * arrives with the execution engine.
 */

import { z } from "zod";
import { config } from "./config";

export const flowSchema = z.object({
  id: z.uuid(),
  /** Every tenant-owned row carries its owner; no query may read flows without scoping by it. */
  tenantId: z.uuid(),
  name: z.string().min(config.validation.flowName.minLength).max(config.validation.flowName.maxLength),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Flow = z.infer<typeof flowSchema>;

export const flowListSchema = z.array(flowSchema);
