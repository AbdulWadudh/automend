/**
 * Flow schemas shared by the API, the worker and the web client.
 *
 * The graph itself lives in `flow-definition.ts`; this module is the row it is stored in and the
 * request bodies that change it.
 */

import { z } from "zod";
import { config } from "./config";
import { flowDefinitionSchema } from "./flow-definition";

const flowNameSchema = z
  .string()
  .trim()
  .min(config.validation.flowName.minLength)
  .max(config.validation.flowName.maxLength);

const flowDescriptionSchema = z.string().trim().max(config.validation.flowDescription.maxLength);

export const flowSchema = z.object({
  id: z.uuid(),
  /** Every tenant-owned row carries its owner; no query may read flows without scoping by it. */
  tenantId: z.uuid(),
  name: flowNameSchema,
  description: flowDescriptionSchema.nullable(),
  definition: flowDefinitionSchema,
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Flow = z.infer<typeof flowSchema>;

export const flowListSchema = z.array(flowSchema);

/**
 * `tenantId` is deliberately absent: it comes from the caller's session, never from the body.
 * Accepting it would let a request write into another workspace.
 */
export const createFlowRequestSchema = z.object({
  name: flowNameSchema,
  description: flowDescriptionSchema.optional(),
  /** Omitted by the "new flow" button; the API stores the default definition instead. */
  definition: flowDefinitionSchema.optional(),
});

export type CreateFlowRequest = z.infer<typeof createFlowRequestSchema>;

/**
 * A partial update, so the builder can save the canvas without resending the name. An empty body
 * is rejected rather than silently touching `updatedAt`.
 */
export const updateFlowRequestSchema = z
  .object({
    name: flowNameSchema.optional(),
    description: flowDescriptionSchema.nullable().optional(),
    definition: flowDefinitionSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateFlowRequest = z.infer<typeof updateFlowRequestSchema>;

/**
 * A request a flow received, as the builder shows it.
 *
 * The body is handed over as the text that arrived rather than parsed here: it may not be JSON,
 * and the drawer shows whatever came in.
 */
export const flowDeliverySchema = z.object({
  id: z.uuid(),
  method: z.string(),
  path: z.string(),
  query: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  body: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});

export type FlowDelivery = z.infer<typeof flowDeliverySchema>;

export const flowDeliveryListSchema = z.array(flowDeliverySchema);
