/**
 * Request parsing.
 *
 * Everything arriving from the network is parsed with a shared Zod schema before any handler
 * looks at it, and a failure becomes one domain error the error handler already knows how to map.
 */

import { requestValidationError } from "@automend/shared";
import type { Context } from "hono";
import type { z } from "zod";

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ");
}

export async function parseJsonBody<Schema extends z.ZodType>(c: Context, schema: Schema): Promise<z.infer<Schema>> {
  // A body that is not JSON at all fails the same way an invalid one does — the caller does not
  // need to know which layer rejected it.
  const body: unknown = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(body);

  if (!result.success) {
    throw requestValidationError(describeIssues(result.error));
  }

  return result.data;
}

export function parseQuery<Schema extends z.ZodType>(c: Context, schema: Schema): z.infer<Schema> {
  const result = schema.safeParse(c.req.query());

  if (!result.success) {
    throw requestValidationError(describeIssues(result.error));
  }

  return result.data;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejected before it reaches a query, so a malformed id answers 400 rather than surfacing as a
 * Postgres "invalid input syntax for type uuid" at 500.
 */
export function parseUuidParam(c: Context, parameterName: string): string {
  const value = c.req.param(parameterName);

  if (!value || !UUID_PATTERN.test(value)) {
    throw requestValidationError(`${parameterName} must be a UUID`);
  }

  return value;
}
