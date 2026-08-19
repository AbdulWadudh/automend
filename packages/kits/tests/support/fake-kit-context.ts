import type {
  HttpRequest,
  HttpResponse,
  KitCredential,
  KitInvocation,
  KitStore,
  LoadOptionsContext,
} from "@automend/kit-framework";

/**
 * A kit invocation built from nothing, so a kit can be exercised without a subprocess, a database or a
 * network.
 *
 * The HTTP double records every call rather than only returning canned answers, because for a kit the
 * interesting assertion is usually *what it asked the service for* — which URL, which headers, what
 * body — not what it did with the reply.
 */

export type FakeHttp = {
  request: (request: HttpRequest) => Promise<HttpResponse>;
  calls: HttpRequest[];
};

export function ok(body: unknown, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

export function failure(status: number, body: unknown = {}): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

/** Responses are returned in order; the last one repeats once the list runs out. */
export function createFakeHttp(responses: readonly HttpResponse[]): FakeHttp {
  const calls: HttpRequest[] = [];
  let next = 0;

  return {
    calls,
    request: async (request) => {
      calls.push(request);
      const response = responses[next] ?? responses.at(-1);
      next += 1;

      if (!response) {
        throw new Error("The fake HTTP client was given no responses to return");
      }

      return response;
    },
  };
}

export function createMemoryStore(seed: Record<string, unknown> = {}): KitStore {
  const values = new Map<string, unknown>(Object.entries(seed));

  return {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

export const googleOAuth: KitCredential = {
  kind: "oauth",
  connectorId: "google",
  accessToken: "test-access-token",
};

export const slackOAuth: KitCredential = {
  kind: "oauth",
  connectorId: "slack",
  accessToken: "test-bot-token",
};

export type FakeContextOverrides = {
  input?: Record<string, unknown>;
  auth?: KitCredential;
  http?: FakeHttp;
  store?: KitStore;
  stepName?: string;
  logged?: string[];
};

export function createFakeContext(overrides: FakeContextOverrides = {}): KitInvocation {
  const logged = overrides.logged ?? [];

  return {
    input: overrides.input ?? {},
    auth: overrides.auth,
    http: overrides.http ?? createFakeHttp([ok({})]),
    store: overrides.store ?? createMemoryStore(),
    run: {
      id: "00000000-0000-4000-8000-000000000001",
      flowId: "00000000-0000-4000-8000-000000000002",
      tenantId: "00000000-0000-4000-8000-000000000003",
      idempotencyKey: "run-key",
    },
    step: { name: overrides.stepName ?? "Step under test" },
    logger: {
      info: (message) => logged.push(message),
      warn: (message) => logged.push(message),
      error: (message) => logged.push(message),
    },
  };
}

/**
 * What an option loader is given. Narrower than a step's context on purpose — there is no run here,
 * so a loader reaching for one should not typecheck.
 */
export function createFakeOptionsContext(overrides: {
  http: FakeHttp;
  auth?: KitCredential;
  input?: Record<string, unknown>;
  logged?: string[];
}): LoadOptionsContext {
  const logged = overrides.logged ?? [];

  return {
    auth: overrides.auth,
    http: overrides.http,
    input: overrides.input ?? {},
    logger: {
      info: (message) => logged.push(message),
      warn: (message) => logged.push(message),
      error: (message) => logged.push(message),
    },
  };
}
