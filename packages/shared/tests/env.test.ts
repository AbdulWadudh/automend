import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import { loadApiEnv, loadWorkerEnv } from "../src/env";
import { isEnvValidationError } from "../src/errors";

const VALID_DATABASE_URL = "postgres://automend:secret@localhost:5432/automend";
const VALID_REDIS_URL = "redis://localhost:6379";

function captureErrorMessage(load: () => unknown): string {
  try {
    load();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }

  throw new Error("expected the loader to throw, but it returned successfully");
}

describe("loadApiEnv", () => {
  test("applies defaults for optional variables", () => {
    const env = loadApiEnv({
      DATABASE_URL: VALID_DATABASE_URL,
      REDIS_URL: VALID_REDIS_URL,
    });

    // Asserts that the loader applies the configured defaults, not what those defaults happen to
    // be — the values themselves are config's business, and config.test.ts guards their shape.
    expect(env.NODE_ENV).toBe(config.env.defaultNodeEnv);
    expect(env.LOG_LEVEL).toBe(config.env.defaultLogLevel);
    expect(env.API_PORT).toBe(config.services.api.defaultPort);
    expect(env.WEB_ORIGIN).toEqual([...config.http.cors.defaultOrigins]);
  });

  test("coerces the port from its string environment value", () => {
    const env = loadApiEnv({
      DATABASE_URL: VALID_DATABASE_URL,
      REDIS_URL: VALID_REDIS_URL,
      API_PORT: "8080",
    });

    expect(env.API_PORT).toBe(8080);
  });

  test("splits WEB_ORIGIN into a trimmed list", () => {
    const env = loadApiEnv({
      DATABASE_URL: VALID_DATABASE_URL,
      REDIS_URL: VALID_REDIS_URL,
      WEB_ORIGIN: "http://localhost:5173, https://app.example.com",
    });

    expect(env.WEB_ORIGIN).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  test("fails fast when a required variable is missing", () => {
    let thrown: unknown;

    try {
      loadApiEnv({ REDIS_URL: VALID_REDIS_URL });
    } catch (error) {
      thrown = error;
    }

    expect(isEnvValidationError(thrown)).toBe(true);
  });

  test("rejects a connection string pointing at the wrong kind of service", () => {
    const message = captureErrorMessage(() =>
      loadApiEnv({
        DATABASE_URL: VALID_REDIS_URL,
        REDIS_URL: VALID_REDIS_URL,
      }),
    );

    expect(message).toContain("DATABASE_URL must start with");
  });

  test("reports every problem at once so one restart surfaces the whole misconfiguration", () => {
    const message = captureErrorMessage(() => loadApiEnv({ API_PORT: "not-a-port" }));

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("REDIS_URL");
    expect(message).toContain("API_PORT");
  });

  test("never echoes the offending value, which may be a secret", () => {
    const message = captureErrorMessage(() =>
      loadApiEnv({
        DATABASE_URL: "mysql://root:hunter2@localhost/db",
        REDIS_URL: VALID_REDIS_URL,
      }),
    );

    expect(message).not.toContain("hunter2");
  });
});

describe("loadWorkerEnv", () => {
  test("defaults concurrency and the health port", () => {
    const env = loadWorkerEnv({
      DATABASE_URL: VALID_DATABASE_URL,
      REDIS_URL: VALID_REDIS_URL,
    });

    expect(env.WORKER_CONCURRENCY).toBe(config.services.worker.defaultConcurrency);
    expect(env.WORKER_HEALTH_PORT).toBe(config.services.worker.defaultHealthPort);
  });

  test("rejects a concurrency of zero", () => {
    const message = captureErrorMessage(() =>
      loadWorkerEnv({
        DATABASE_URL: VALID_DATABASE_URL,
        REDIS_URL: VALID_REDIS_URL,
        WORKER_CONCURRENCY: "0",
      }),
    );

    expect(message).toContain("WORKER_CONCURRENCY");
  });
});
