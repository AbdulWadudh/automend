import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import { loadApiEnv, loadWorkerEnv } from "../src/env";
import { isEnvValidationError } from "../src/errors";

const VALID_DATABASE_URL = "postgres://automend:secret@localhost:5432/automend";
const VALID_REDIS_URL = "redis://localhost:6379";
const VALID_AUTH_SECRET = "s".repeat(config.auth.secretMinLength);

/** The variables the API cannot start without, so each test only states what it is about. */
const REQUIRED_API_ENV = {
  DATABASE_URL: VALID_DATABASE_URL,
  REDIS_URL: VALID_REDIS_URL,
  AUTH_SECRET: VALID_AUTH_SECRET,
  SECRETS_KEY: "k".repeat(config.secrets.keyLengthBytes),
};

/**
 * The same for the worker, which is a longer list than it used to be.
 *
 * The engine resolves each step's credentials itself, so the worker needs the auth values the API has — the same
 * values, not copies of them. Given different ones it would refresh no OAuth token and decrypt no stored secret.
 */
const REQUIRED_WORKER_ENV = {
  DATABASE_URL: VALID_DATABASE_URL,
  REDIS_URL: VALID_REDIS_URL,
  AUTH_SECRET: VALID_AUTH_SECRET,
  SECRETS_KEY: "k".repeat(config.secrets.keyLengthBytes),
};

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
    const env = loadApiEnv(REQUIRED_API_ENV);

    // Asserts that the loader applies the configured defaults, not what those defaults happen to
    // be — the values themselves are config's business, and config.test.ts guards their shape.
    expect(env.NODE_ENV).toBe(config.env.defaultNodeEnv);
    expect(env.LOG_LEVEL).toBe(config.env.defaultLogLevel);
    expect(env.API_PORT).toBe(config.services.api.defaultPort);
    expect(env.WEB_ORIGIN).toEqual([...config.http.cors.defaultOrigins]);
  });

  test("coerces the port from its string environment value", () => {
    const env = loadApiEnv({ ...REQUIRED_API_ENV, API_PORT: "8080" });

    expect(env.API_PORT).toBe(8080);
  });

  test("splits WEB_ORIGIN into a trimmed list", () => {
    const env = loadApiEnv({
      ...REQUIRED_API_ENV,
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
    const message = captureErrorMessage(() => loadApiEnv({ ...REQUIRED_API_ENV, DATABASE_URL: VALID_REDIS_URL }));

    expect(message).toContain("DATABASE_URL must start with");
  });

  test("reports every problem at once so one restart surfaces the whole misconfiguration", () => {
    const message = captureErrorMessage(() => loadApiEnv({ API_PORT: "not-a-port" }));

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("REDIS_URL");
    expect(message).toContain("API_PORT");
  });

  test("rejects an auth secret short enough to guess", () => {
    const message = captureErrorMessage(() =>
      loadApiEnv({ ...REQUIRED_API_ENV, AUTH_SECRET: "s".repeat(config.auth.secretMinLength - 1) }),
    );

    expect(message).toContain("AUTH_SECRET");
  });

  test("treats a half-configured social provider as switched off", () => {
    // Both halves or neither: a client id without its secret would fail at the redirect, long
    // after the sign-in page had already offered the button.
    const env = loadApiEnv({ ...REQUIRED_API_ENV, GOOGLE_CLIENT_ID: "id-without-a-secret" });

    expect(env.GOOGLE_CLIENT_ID).toBe("id-without-a-secret");
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  test("treats an empty provider credential as absent", () => {
    const env = loadApiEnv({ ...REQUIRED_API_ENV, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" });

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  test("defaults the auth base URL to the browser's origin, not the API's", () => {
    // OAuth redirects come back to where the browser is, which is the web app.
    expect(loadApiEnv(REQUIRED_API_ENV).AUTH_BASE_URL).toBe(config.localDev.urls.webDev);
  });

  test("never echoes the offending value, which may be a secret", () => {
    const message = captureErrorMessage(() =>
      loadApiEnv({ ...REQUIRED_API_ENV, DATABASE_URL: "mysql://root:hunter2@localhost/db" }),
    );

    expect(message).not.toContain("hunter2");
  });
});

describe("loadApiEnv — the queue dashboard's credentials", () => {
  const VALID_PASSWORD = "d".repeat(config.ops.queueDashboard.passwordMinLength);

  test("both halves absent leaves the dashboard switched off", () => {
    const env = loadApiEnv(REQUIRED_API_ENV);

    expect(env.OPS_DASHBOARD_USER).toBeUndefined();
    expect(env.OPS_DASHBOARD_PASSWORD).toBeUndefined();
  });

  test("both halves present switches it on", () => {
    const env = loadApiEnv({
      ...REQUIRED_API_ENV,
      OPS_DASHBOARD_USER: "operator",
      OPS_DASHBOARD_PASSWORD: VALID_PASSWORD,
    });

    expect(env.OPS_DASHBOARD_USER).toBe("operator");
    expect(env.OPS_DASHBOARD_PASSWORD).toBe(VALID_PASSWORD);
  });

  test("an empty value is absent rather than a password of length zero", () => {
    const env = loadApiEnv({ ...REQUIRED_API_ENV, OPS_DASHBOARD_USER: "", OPS_DASHBOARD_PASSWORD: "" });

    expect(env.OPS_DASHBOARD_USER).toBeUndefined();
    expect(env.OPS_DASHBOARD_PASSWORD).toBeUndefined();
  });

  test("a short password is refused rather than treated as good enough", () => {
    // The point of the bound: unlike a half-configured OAuth provider, a weak value here does not
    // fail closed — it would stand as the only guard on every tenant's job payloads.
    const message = captureErrorMessage(() =>
      loadApiEnv({
        ...REQUIRED_API_ENV,
        OPS_DASHBOARD_USER: "operator",
        OPS_DASHBOARD_PASSWORD: "d".repeat(config.ops.queueDashboard.passwordMinLength - 1),
      }),
    );

    expect(message).toContain("OPS_DASHBOARD_PASSWORD");
    expect(message).toContain(String(config.ops.queueDashboard.passwordMinLength));
  });

  test("a short password is refused even with no username beside it", () => {
    // Otherwise the length check is reachable only through the configuration that already works,
    // and a typo'd username silently downgrades the password to unvalidated.
    const message = captureErrorMessage(() => loadApiEnv({ ...REQUIRED_API_ENV, OPS_DASHBOARD_PASSWORD: "short" }));

    expect(message).toContain("OPS_DASHBOARD_PASSWORD");
  });

  test("the failure never echoes the password", () => {
    const password = "far-too-short";
    const message = captureErrorMessage(() => loadApiEnv({ ...REQUIRED_API_ENV, OPS_DASHBOARD_PASSWORD: password }));

    expect(message).not.toContain(password);
  });

  test("the studio's address is absent unless a deployment names one", () => {
    // Undefined rather than defaulted: a default would put a link to localhost in every user's sidebar
    // on a deployment that forgot to set it, and an address the browser cannot reach is worse than none.
    expect(loadApiEnv(REQUIRED_API_ENV).STUDIO_URL).toBeUndefined();
    expect(loadApiEnv({ ...REQUIRED_API_ENV, STUDIO_URL: "" }).STUDIO_URL).toBeUndefined();
  });

  test("the studio's address is kept when it is a URL the browser could follow", () => {
    const studioUrl = "https://studio.example.com";

    expect(loadApiEnv({ ...REQUIRED_API_ENV, STUDIO_URL: studioUrl }).STUDIO_URL).toBe(studioUrl);
  });

  test("a studio address that is not an http URL is refused rather than passed to the browser", () => {
    const message = captureErrorMessage(() =>
      loadApiEnv({ ...REQUIRED_API_ENV, STUDIO_URL: "postgres://studio:5432" }),
    );

    expect(message).toContain("STUDIO_URL");
  });
});

describe("loadWorkerEnv", () => {
  test("defaults concurrency and the health port", () => {
    const env = loadWorkerEnv(REQUIRED_WORKER_ENV);

    expect(env.WORKER_CONCURRENCY).toBe(config.services.worker.defaultConcurrency);
    expect(env.WORKER_HEALTH_PORT).toBe(config.services.worker.defaultHealthPort);
  });

  test("rejects a concurrency of zero", () => {
    const message = captureErrorMessage(() => loadWorkerEnv({ ...REQUIRED_WORKER_ENV, WORKER_CONCURRENCY: "0" }));

    expect(message).toContain("WORKER_CONCURRENCY");
  });

  /**
   * The default matters more than most: with this on, an HTTP step's URL can come from a flow's *data*, so whoever
   * sends a webhook chooses where the worker connects — Postgres, Redis, or the cloud metadata service.
   */
  test("refuses private network access unless a deployment asks for it", () => {
    expect(loadWorkerEnv(REQUIRED_WORKER_ENV).ENGINE_ALLOW_PRIVATE_NETWORK).toBe(
      config.engine.http.allowPrivateNetworkByDefault,
    );
    expect(config.engine.http.allowPrivateNetworkByDefault).toBe(false);
  });

  test("private network access can be turned on explicitly", () => {
    const env = loadWorkerEnv({ ...REQUIRED_WORKER_ENV, ENGINE_ALLOW_PRIVATE_NETWORK: "true" });

    expect(env.ENGINE_ALLOW_PRIVATE_NETWORK).toBe(true);
  });

  /** Without them the engine cannot resolve a credential, so starting up and failing later would be worse. */
  test("will not start without the values it needs to resolve a connection", () => {
    const withoutSecretsKey = { ...REQUIRED_WORKER_ENV, SECRETS_KEY: undefined };
    const withoutAuthSecret = { ...REQUIRED_WORKER_ENV, AUTH_SECRET: undefined };

    expect(captureErrorMessage(() => loadWorkerEnv(withoutSecretsKey))).toContain("SECRETS_KEY");
    expect(captureErrorMessage(() => loadWorkerEnv(withoutAuthSecret))).toContain("AUTH_SECRET");
  });
});
