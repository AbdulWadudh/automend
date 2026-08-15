/**
 * The response envelope every API route uses.
 *
 * Success: `{ "data": ... }`
 * Failure: `{ "error": { "code": "...", "message": "..." } }`
 *
 * Both the API and the web client import these schemas, so a change to the wire format is a
 * single edit that breaks the type-check on both sides at once.
 */

import { z } from "zod";
import { API_ERROR_CODES } from "./errors";

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** Wraps a payload schema in the success envelope: `apiSuccessSchema(flowSchema.array())`. */
export function apiSuccessSchema<Schema extends z.ZodType>(dataSchema: Schema) {
  return z.object({ data: dataSchema });
}

export const dependencyHealthSchema = z.object({
  status: z.enum(["up", "down"]),
  latencyMs: z.number().int().nonnegative(),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthReportSchema = z.object({
  service: z.string(),
  status: z.enum(["healthy", "unhealthy"]),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.object({
    postgres: dependencyHealthSchema,
    redis: dependencyHealthSchema,
  }),
});

export type HealthReport = z.infer<typeof healthReportSchema>;

export const healthResponseSchema = apiSuccessSchema(healthReportSchema);
