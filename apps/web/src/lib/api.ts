/**
 * Typed API client.
 *
 * Responses are parsed with the same Zod schemas the API builds them from, so a wire-format
 * change fails the type-check on both sides instead of producing `undefined` in a component.
 *
 * Every path is relative: the browser only ever calls this app's own origin, which proxies to the
 * API. That is what keeps the API address out of the bundle and the session cookie first-party.
 */

import { apiErrorBodySchema, config, type HealthReport, healthResponseSchema } from "@automend/shared";
import { z } from "zod";
import { webEnv } from "./env";

export function apiResponseError(message: string): Error {
  return Object.assign(new Error(message), { name: "ApiResponseError" });
}

/**
 * Carries the API's own error code, so a caller can react to *what* went wrong — a 401 sends the
 * user to sign in — rather than matching on message text.
 */
export type ApiRequestError = Error & { code: string; status: number };

export function apiRequestError(message: string, code: string, status: number): ApiRequestError {
  return Object.assign(new Error(message), { name: "ApiRequestError", code, status });
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof Error && "status" in error && (error as ApiRequestError).status === 401;
}

export type ApiRequestOptions<Schema extends z.ZodType> = {
  path: string;
  schema: Schema;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function requestApi<Schema extends z.ZodType>({
  path,
  schema,
  method = "GET",
  body,
  signal,
}: ApiRequestOptions<Schema>): Promise<z.infer<Schema>> {
  const response = await fetch(`${webEnv.apiBasePath}${path}`, {
    method,
    headers:
      body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = apiErrorBodySchema.safeParse(payload);

    throw parsedError.success
      ? apiRequestError(parsedError.data.error.message, parsedError.data.error.code, response.status)
      : apiRequestError(`The API answered ${response.status}`, "UNKNOWN", response.status);
  }

  // Unwrapped in two steps: the envelope first, then its payload against the caller's schema.
  // Parsing the composed schema in one go loses the inferred return type through the generic.
  const envelope = z.object({ data: z.unknown() }).safeParse(payload);
  const parsed = envelope.success ? schema.safeParse(envelope.data.data) : undefined;

  if (!parsed?.success) {
    throw apiResponseError(`Unexpected response from ${path}`);
  }

  return parsed.data;
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
