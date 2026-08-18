/**
 * The only way a kit reaches the network.
 *
 * Kits are handed this interface rather than `fetch`, and that is the point: the timeout, the
 * redirect limit, the response size cap and the refusal to call private addresses are enforced by
 * the single implementation in the engine instead of being re-remembered by every kit author. A kit
 * that could call `fetch` directly could bypass all four.
 *
 * The interface lives here so kits can be tested against a fake; the guarded implementation lives in
 * the worker's engine.
 */

import type { config } from "@automend/shared";

export type HttpMethod = (typeof config.flows.httpMethods)[number];

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  rawBody?: string;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  /** Parsed when the response declares JSON, otherwise the body as text. */
  body: unknown;
};

/**
 * A failing status is *returned*, not thrown.
 *
 * `http.request` exists to report what a URL answered, including a 404 — throwing would make that
 * impossible to express. Kits that treat an error status as failure say so with `assertOk`.
 */
export type HttpClient = {
  request: (request: HttpRequest) => Promise<HttpResponse>;
};

/** Structured, redacting, and never given the credential — see the engine's implementation. */
export type KitLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};
