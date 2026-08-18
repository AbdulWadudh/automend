import { describe, expect, test } from "bun:test";
import { config } from "../src/config";

/**
 * These guard invariants that are easy to break by editing a single value in `config.ts`, and that
 * would otherwise only surface as a subtle runtime problem.
 *
 * They deliberately assert *relationships between* config values, never specific literals — a test
 * that reads its expected value from config asserts nothing.
 */
describe("derived values stay in step with their primitives", () => {
  test("CORS origins are built from the web ports, not written out by hand", () => {
    const origins = config.http.cors.defaultOrigins;

    expect(origins).toContain(`http://${config.localDev.host}:${config.services.web.devServerPort}`);
    expect(origins).toContain(`http://${config.localDev.host}:${config.services.web.defaultPort}`);
  });

  test("the dev proxy target points at the API's own default port", () => {
    expect(config.services.web.defaultApiProxyTarget).toContain(String(config.services.api.defaultPort));
    expect(config.localDev.urls.api).toBe(config.services.web.defaultApiProxyTarget);
  });

  test("the versioned health route is built from the API base path", () => {
    expect(config.http.routes.apiHealth).toBe(`${config.http.basePath}${config.http.routes.health}`);
  });

  test("the API proxy pattern matches the prefix the routes are mounted under", () => {
    expect(config.http.routes.apiProxyPattern).toBe(`${config.http.routes.apiProxyPrefix}/*`);
    expect(config.http.basePath.startsWith(config.http.routes.apiProxyPrefix)).toBe(true);
  });

  test("the browser's default API base path matches the server's", () => {
    expect(config.webClient.defaultApiBasePath).toBe(config.http.basePath);
  });

  test("every API route is versioned, including the ones Better-Auth owns", () => {
    const versionedRoutes = [
      config.http.routes.apiHealth,
      config.http.routes.flows,
      config.http.routes.auth,
      config.http.routes.authProviders,
    ];

    for (const route of versionedRoutes) {
      expect(route.startsWith(config.http.basePath)).toBe(true);
    }
  });

  test("no route of ours sits inside the subtree Better-Auth generates", () => {
    // Better-Auth builds its own paths beneath `auth`, and a plugin can add one at any version.
    // Anything of ours in there would end up shadowing it, or being shadowed by it, silently.
    const ourRoutes = [config.http.routes.apiHealth, config.http.routes.flows, config.http.routes.authProviders];

    for (const route of ourRoutes) {
      expect(route.startsWith(`${config.http.routes.auth}/`)).toBe(false);
    }
  });

  test("the app's page routes are built from one another, not written out twice", () => {
    const { routes } = config.webClient;

    expect(routes.flows.startsWith(`${routes.app}/`)).toBe(true);
    expect(routes.flowDetail.startsWith(`${routes.flows}/`)).toBe(true);
    expect(routes.flowDetail.endsWith(`$${config.webClient.flowIdParam}`)).toBe(true);
  });

  test("local dev connection strings are composed from the same credentials and ports", () => {
    const { postgres, redis, urls, host } = config.localDev;

    expect(urls.database).toBe(
      `postgres://${postgres.user}:${postgres.password}@${host}:${postgres.containerPort}/${postgres.database}`,
    );
    expect(urls.redis).toBe(`redis://${host}:${redis.containerPort}`);
  });
});

describe("queue configuration", () => {
  test("every queue name is wrapped in a Dragonfly hashtag", () => {
    const queueNames = Object.values(config.queue).map((queue) => queue.name);

    expect(queueNames.length).toBeGreaterThan(0);

    for (const name of queueNames) {
      // Without the braces, Dragonfly locks the entire store for every BullMQ Lua script.
      expect(name).toMatch(/^\{[^{}]+\}$/);
    }
  });

  /**
   * Retention is what the queue dashboard has to look at. `removeOnComplete: true` deleted every successful job
   * the instant it finished, so a run that had plainly executed left nothing behind to inspect or re-run.
   */
  test("finished jobs are kept, and kept in bounded numbers", () => {
    const { retention } = config.queue.flowExecutions;

    expect(retention.completedJobs).toBeGreaterThan(0);
    expect(retention.failedJobs).toBeGreaterThan(0);
  });

  test("more failures are kept than successes", () => {
    // A completed job is history; a failed one is work somebody may still want to read or re-run, and it has to
    // outlive the successes accumulating around it.
    const { retention } = config.queue.flowExecutions;

    expect(retention.failedJobs).toBeGreaterThan(retention.completedJobs);
  });

  test("queue hashtags are distinct, so queues do not all serialise on one thread", () => {
    const hashtags = Object.values(config.queue).map((queue) => queue.name);

    expect(new Set(hashtags).size).toBe(hashtags.length);
  });
});

describe("service configuration", () => {
  const defaultPorts = [
    config.services.api.defaultPort,
    config.services.worker.defaultHealthPort,
    config.services.web.defaultPort,
    config.services.web.devServerPort,
    config.localDev.postgres.containerPort,
    config.localDev.redis.containerPort,
  ];

  test("default ports are inside the range the env loader accepts", () => {
    for (const port of defaultPorts) {
      expect(port).toBeGreaterThanOrEqual(config.env.port.min);
      expect(port).toBeLessThanOrEqual(config.env.port.max);
    }
  });

  test("default ports do not collide", () => {
    expect(new Set(defaultPorts).size).toBe(defaultPorts.length);
  });

  test("default worker concurrency sits within its own bounds", () => {
    expect(config.services.worker.defaultConcurrency).toBeGreaterThanOrEqual(config.services.worker.minConcurrency);
    expect(config.services.worker.defaultConcurrency).toBeLessThanOrEqual(config.services.worker.maxConcurrency);
  });
});

describe("http configuration", () => {
  test("route paths are absolute", () => {
    for (const route of Object.values(config.http.routes)) {
      if (route === config.http.routes.wildcard) {
        continue;
      }
      expect(route.startsWith("/")).toBe(true);
    }
  });
});

describe("operator consoles", () => {
  test("the ops proxy pattern matches the prefix the consoles are mounted under", () => {
    expect(config.http.routes.opsProxyPattern).toBe(`${config.http.routes.opsPrefix}/*`);
  });

  test("the queue dashboard sits under the ops prefix", () => {
    expect(config.http.routes.queueDashboard.startsWith(`${config.http.routes.opsPrefix}/`)).toBe(true);
  });

  test("the queue dashboard is outside the versioned API, which answers with an envelope", () => {
    // It serves HTML and a static bundle. Inside `/api/v1` it would be the one route there that does
    // not answer with `{ data }` / `{ error }`, and the web app's `/api` proxy would reach it by a
    // second path with different CORS treatment.
    expect(config.http.routes.queueDashboard.startsWith(config.http.basePath)).toBe(false);
    expect(config.http.routes.opsPrefix.startsWith(config.http.routes.apiProxyPrefix)).toBe(false);
  });

  test("the ops prefix does not collide with the other two the web app proxies", () => {
    const prefixes = [
      config.http.routes.apiProxyPrefix,
      config.http.routes.otlpProxyPrefix,
      config.http.routes.opsPrefix,
    ];

    expect(new Set(prefixes).size).toBe(prefixes.length);

    for (const prefix of prefixes) {
      for (const other of prefixes) {
        // A prefix that is a prefix of another means one proxy rule shadows the other, and which one
        // wins is registration order rather than anything a reader would predict.
        expect(prefix === other || !other.startsWith(`${prefix}/`)).toBe(true);
      }
    }
  });

  test("the operations API is versioned like every other API route", () => {
    // It is the JSON API *about* the consoles, not a console — so it belongs under the version prefix
    // and answers with the envelope, unlike the dashboard itself.
    expect(config.http.routes.operations.startsWith(config.http.basePath)).toBe(true);
  });

  test("the operations API is not inside the prefix the web app proxies verbatim", () => {
    // `/ops` is forwarded with its path untouched because a dashboard's assets depend on it. An
    // envelope-returning API in there would make that rule ambiguous.
    expect(config.http.routes.operations.startsWith(`${config.http.routes.opsPrefix}/`)).toBe(false);
  });

  test("the operations sub-paths are relative, so the route file and the client agree", () => {
    for (const subPath of [config.http.routes.operationsConsoles, config.http.routes.operationsSession]) {
      expect(subPath.startsWith("/")).toBe(true);
      expect(subPath.startsWith(config.http.basePath)).toBe(false);
    }
  });

  test("the page that unlocks a console is inside the signed-in app", () => {
    // Where the dashboard redirects an unauthenticated browser. Outside `/app` it would be reachable
    // without signing in, and the redirect would land on the sign-in page instead.
    expect(config.webClient.routes.operations.startsWith(`${config.webClient.routes.app}/`)).toBe(true);
  });

  test("the operator grant lapses sooner than a user session", () => {
    // It grants far more than signing in does, so it should expire over a weekend rather than persist
    // for a month.
    expect(config.ops.queueDashboard.session.maxAgeSeconds).toBeLessThan(config.auth.session.expiresInSeconds);
  });

  test("a submitted operator password is bounded above as well as below", () => {
    // The lower bound constrains the deployment's configuration; the upper bound constrains a request,
    // so a sign-in attempt cannot hand the api an arbitrarily large body to hash.
    expect(config.validation.opsPassword.maxLength).toBeGreaterThan(config.ops.queueDashboard.passwordMinLength);
  });

  test("the local studio password is never blank", () => {
    // Not cosmetic. Drizzle Gateway reads an absent master password as "accept any password" — it still
    // renders a login box and lets anything through, so a blank value ships a console that looks
    // guarded and is not.
    expect(config.ops.databaseStudio.localPassword.length).toBeGreaterThan(0);
  });

  test("a password long enough to matter is required of the queue dashboard", () => {
    // The one guard on a console that reads every tenant's job payloads, so the bound exists rather
    // than being left to whoever writes the .env.
    expect(config.ops.queueDashboard.passwordMinLength).toBeGreaterThanOrEqual(16);
  });

  test("the database studio's image is pinned rather than tracking a moving tag", () => {
    // `:latest` would let a redeploy change what is reading the database without a diff saying so.
    expect(config.ops.databaseStudio.image).toContain(":");
    expect(config.ops.databaseStudio.image.endsWith(":latest")).toBe(false);
  });

  test("the studio's local URL is built from its container port", () => {
    expect(config.localDev.urls.studio).toContain(String(config.ops.databaseStudio.containerPort));
  });

  test("the studio's port does not collide with anything else the stack binds", () => {
    const ports = [
      config.services.api.defaultPort,
      config.services.worker.defaultHealthPort,
      config.services.web.defaultPort,
      config.services.web.devServerPort,
      config.localDev.postgres.containerPort,
      config.localDev.redis.containerPort,
      config.ops.databaseStudio.containerPort,
    ];

    expect(new Set(ports).size).toBe(ports.length);
  });
});

describe("web client routes", () => {
  const webRoutes = Object.values(config.webClient.routes);

  test("every route is an absolute path the router can match", () => {
    for (const route of webRoutes) {
      expect(route.startsWith("/")).toBe(true);
    }
  });

  test("routes are distinct, so no two pages claim the same address", () => {
    expect(new Set(webRoutes).size).toBe(webRoutes.length);
  });

  test("landing anchors are bare fragment identifiers", () => {
    for (const anchor of Object.values(config.webClient.landingSections)) {
      expect(anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test("no page route collides with a prefix the web server proxies away", () => {
    // A page at /api or /otlp would never reach the SPA — server.ts forwards those upstream first.
    const proxiedPrefixes = [config.http.routes.apiProxyPrefix, config.http.routes.otlpProxyPrefix];

    for (const route of webRoutes) {
      for (const prefix of proxiedPrefixes) {
        expect(route.startsWith(prefix)).toBe(false);
      }
    }
  });
});

describe("public identity", () => {
  test("every contact address is derived from the one public domain", () => {
    for (const address of Object.values(config.company.emails)) {
      expect(address.endsWith(`@${config.company.domain}`)).toBe(true);
    }
  });

  test("contact mailboxes are distinct, so two roles cannot share an inbox by accident", () => {
    const addresses = Object.values(config.company.emails);

    expect(new Set(addresses).size).toBe(addresses.length);
  });

  test("the legal effective date is a full ISO calendar date", () => {
    expect(config.company.legal.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(config.company.legal.effectiveDate))).toBe(false);
  });
});

describe("telemetry configuration", () => {
  test("appVersion matches the root package.json, which the browser bundle cannot read", async () => {
    const packageJsonUrl = new URL("../../../package.json", import.meta.url);
    const rootPackageJson = (await Bun.file(packageJsonUrl).json()) as { version: string };

    // Asserted in this direction because `as const` narrows config.appVersion to a literal type.
    expect(rootPackageJson.version).toBe(config.appVersion);
  });

  test("the OTLP logs path is appended to an endpoint, not baked into it", () => {
    expect(config.telemetry.logsPath.startsWith("/")).toBe(true);
    expect(config.telemetry.defaultEndpoint).not.toContain(config.telemetry.logsPath);
  });

  test("the default OTLP endpoint points at the collector's HTTP port", () => {
    expect(config.telemetry.defaultEndpoint).toContain(String(config.telemetry.otlpHttpPort));
  });

  test("every log level maps to an OTel severity number", () => {
    for (const level of config.env.logLevels) {
      expect(config.telemetry.logLevelToSeverityNumber).toHaveProperty(level);
    }
  });

  test("the browser proxy prefix does not collide with the API prefix", () => {
    expect(config.http.routes.otlpProxyPrefix).not.toBe(config.http.routes.apiProxyPrefix);
  });
});

describe("logging configuration", () => {
  test("connection strings are redacted", () => {
    expect(config.logging.redactedPaths).toContain("DATABASE_URL");
    expect(config.logging.redactedPaths).toContain("REDIS_URL");
  });
});

describe("kit configuration", () => {
  test("every schedulable strategy is a strategy that exists", () => {
    const strategies: readonly string[] = config.kits.triggerStrategies;

    for (const strategy of config.kits.schedulableTriggerStrategies) {
      expect(strategies).toContain(strategy);
    }
  });

  /**
   * Not every strategy is schedulable yet — `polling` and `cron` are defined but nothing fires them —
   * so this asserts the list is a real subset rather than that it is complete.
   */
  test("there is at least one way to start a flow", () => {
    expect(config.kits.schedulableTriggerStrategies.length).toBeGreaterThan(0);
    expect(config.kits.schedulableTriggerStrategies.length).toBeLessThanOrEqual(config.kits.triggerStrategies.length);
  });

  test("no vocabulary list repeats an entry", () => {
    const { propertyTypes, triggerStrategies, dedupeStrategies } = config.kits;

    for (const list of [propertyTypes, triggerStrategies, dedupeStrategies]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("a trigger test shows fewer items than a real poll may return", () => {
    expect(config.kits.testPollItems).toBeLessThan(config.kits.maxPollItems);
  });
});

describe("engine limits", () => {
  test("a step cannot outlast the run it belongs to", () => {
    expect(config.engine.stepTimeoutMs).toBeLessThanOrEqual(config.engine.runTimeoutMs);
  });

  /**
   * A delay blocks its step, so a wait longer than the step timeout would be killed mid-wait. Derived
   * from the timeout in `config.ts` rather than written down twice, which is what this checks.
   */
  test("the longest allowed wait finishes before its step is killed", () => {
    expect(config.flows.delay.maxMs).toBeLessThan(config.engine.stepTimeoutMs);
    expect(config.flows.delay.defaultMs).toBeLessThanOrEqual(config.flows.delay.maxMs);
    expect(config.flows.delay.minMs).toBeLessThan(config.flows.delay.maxMs);
  });

  test("an HTTP request cannot outlast the step making it", () => {
    expect(config.engine.http.requestTimeoutMs).toBeLessThan(config.engine.stepTimeoutMs);
  });

  test("a response body cannot exceed what the subprocess may report", () => {
    expect(config.engine.http.maxResponseBytes).toBeLessThanOrEqual(config.engine.maxOutputBytes);
  });
});
