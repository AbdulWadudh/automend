/**
 * The two response shapes every route uses. Routes never call `c.json` directly, so the envelope
 * cannot drift from one endpoint to the next.
 */

import type { ApiErrorCode, ApiHttpStatus } from "@automend/shared";
import type { Context } from "hono";

export function respondWithData<Data>(c: Context, data: Data, status: 200 | 201 | 202 = 200) {
  return c.json({ data }, status);
}

export function respondWithError(c: Context, code: ApiErrorCode, message: string, status: ApiHttpStatus) {
  return c.json({ error: { code, message } }, status);
}

/**
 * Health is the one route that returns the success envelope with a non-2xx status: the report is
 * still the payload, but an unhealthy dependency must not read as 200 to an orchestrator.
 */
export function respondWithHealth<Data>(c: Context, data: Data, isHealthy: boolean) {
  return c.json({ data }, isHealthy ? 200 : 503);
}
