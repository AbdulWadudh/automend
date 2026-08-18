import type { KitCredential, KitInvocation } from "../../src/context";
import type { HttpRequest, HttpResponse } from "../../src/http";
import type { KitStore } from "../../src/store";

/**
 * A `KitInvocation` built from nothing, so a kit can be exercised without a database, a subprocess or
 * a network. Every collaborator is recorded rather than stubbed silently, which is what lets a test
 * assert *what* a kit asked the service for rather than only what it returned.
 */

export type FakeHttp = {
  request: (request: HttpRequest) => Promise<HttpResponse>;
  calls: HttpRequest[];
};

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

export type FakeInvocationOverrides = {
  input?: Record<string, unknown>;
  auth?: KitCredential;
  http?: FakeHttp;
  store?: KitStore;
  stepName?: string;
};

export function createFakeInvocation(overrides: FakeInvocationOverrides = {}): KitInvocation {
  return {
    input: overrides.input ?? {},
    auth: overrides.auth,
    http: overrides.http ?? createFakeHttp([{ status: 200, headers: {}, body: {} }]),
    store: overrides.store ?? createMemoryStore(),
    run: {
      id: "00000000-0000-4000-8000-000000000001",
      flowId: "00000000-0000-4000-8000-000000000002",
      tenantId: "00000000-0000-4000-8000-000000000003",
      idempotencyKey: "run-key",
    },
    step: { name: overrides.stepName ?? "Step under test" },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}
