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
