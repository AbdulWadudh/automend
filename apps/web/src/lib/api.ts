/**
 * Typed API client.
 *
 * Responses are parsed with the same Zod schemas the API builds them from, so a wire-format
 * change fails the type-check on both sides instead of producing `undefined` in a component.
 */

import { config, type HealthReport, healthResponseSchema } from "@automend/shared";
import { webEnv } from "./env";

export function apiResponseError(message: string): Error {
  return Object.assign(new Error(message), { name: "ApiResponseError" });
}

/**
 * A degraded API answers 503 but still returns a full report, which is exactly what the UI wants
 * to show. So the status code is not treated as a failure — only an unparseable body is.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  const response = await fetch(`${webEnv.apiBasePath}${config.http.routes.health}`, {
    headers: { accept: "application/json" },
    signal,
  });

  const body: unknown = await response.json().catch(() => null);
  const parsed = healthResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw apiResponseError(`Unexpected health response (HTTP ${response.status}) — the API may be unreachable`);
  }

  return parsed.data.data;
}
