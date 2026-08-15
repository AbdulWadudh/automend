/**
 * The single source of truth for every configured value in Automend.
 *
 * Nothing in the codebase hardcodes a port, timeout, limit, route path, queue name or default —
 * it is defined here once and imported as `config.<domain>.<value>`.
 *
 * The file has two halves, and the split is the whole point:
 *
 * 1. **Primitives** — the small set of values a human actually chooses. Each appears exactly once.
 * 2. **`config`** — everything else, *derived* from those primitives. A URL is never written out
 *    as a string literal; it is composed from a host and a port. Change `WEB_DEV_PORT` and the
 *    CORS origin list, the Vite dev server and the generated `.env.example` all follow.
 *
 * If you find yourself typing a port number or a host inside the `config` object below, it belongs
 * in the primitives block instead.
 *
 * Alongside this file, `env.ts` holds per-deployment overrides, Zod-validated at startup. Its
 * defaults come from here; it never hardcodes one.
 *
 * This module imports nothing, so anything — including the browser bundle — can import it.
 */

// ───────────────────────────── Primitives ─────────────────────────────
// The only place a port, host or path segment is written down.

const API_PORT = 3000;
const WORKER_HEALTH_PORT = 3002;
const WEB_PORT = 8080;
const WEB_DEV_PORT = 5173;

/** Fixed by the official Postgres and Redis images; not ours to choose. */
const POSTGRES_CONTAINER_PORT = 5432;
const REDIS_CONTAINER_PORT = 6379;

const LOCAL_HOST = "localhost";

/**
 * Reported to the telemetry backend as `service.version`. Mirrors the root package.json version —
 * `tests/config.test.ts` fails if the two drift, since the browser bundle cannot read that file.
 */
const APP_VERSION = "0.1.0";

const API_PREFIX = "/api";
const API_VERSION = "v1";
const HEALTH_PATH = "/health";

/**
 * Only *links* read these. `createFileRoute()` still takes a string literal, because the router
 * plugin derives the route tree from the file name and cannot resolve a value from here.
 */
const HOME_ROUTE = "/";
const STATUS_ROUTE = "/status";
const PRIVACY_ROUTE = "/privacy";
const TERMS_ROUTE = "/tos";

const PRODUCT_NAME = "Automend";
const PUBLIC_DOMAIN = "automend.k79.quest";
const REPOSITORY_URL = "https://github.com/AbdulWadudh/automend";

/** OTLP ingestion ports. Fixed by the OpenTelemetry spec, not ours to choose. */
const OTLP_HTTP_PORT = 4318;
const OTLP_GRPC_PORT = 4317;

/** Path the browser posts its log records to on the web app's own origin, then proxied on. */
const OTLP_PROXY_PREFIX = "/otlp";

/**
 * Local development credentials for the compose stack. Deliberately trivial and non-secret —
 * real deployments supply their own through the environment, and these never reach an image.
 */
const LOCAL_POSTGRES_USER = "automend";
const LOCAL_POSTGRES_PASSWORD = "automend";
const LOCAL_POSTGRES_DATABASE = "automend";

/** Compose service names — how one container addresses another on the local stack's network. */
const LOCAL_POSTGRES_SERVICE = "postgres";
const LOCAL_REDIS_SERVICE = "redis";

/**
 * Images for the local stack. Keep the Postgres major version in step with the deployed one —
 * developing against a different major is how a migration passes locally and fails in production.
 */
const LOCAL_POSTGRES_IMAGE = "postgres:18-alpine";
const LOCAL_REDIS_IMAGE = "docker.dragonflydb.io/dragonflydb/dragonfly:v1.40.1";

/**
 * Where the Postgres data volume mounts.
 *
 * Postgres 18 moved `PGDATA` to `/var/lib/postgresql/<major>/docker` and now declares the *parent*
 * `/var/lib/postgresql` as its volume, so that is what must be mounted. Mounting the old
 * `/var/lib/postgresql/data` against an 18 image silently gets you a container whose data lives
 * outside the volume — it looks fine until the container is recreated and the database is empty.
 */
const LOCAL_POSTGRES_DATA_PATH = "/var/lib/postgresql";

// ───────────────────────────── Derivations ─────────────────────────────

function httpUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function postgresUrl(options: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const { host, port, user, password, database } = options;
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

function redisUrl(host: string, port: number): string {
  return `redis://${host}:${port}`;
}

function emailAddress(mailbox: string, domain: string): string {
  return `${mailbox}@${domain}`;
}

const API_BASE_PATH = `${API_PREFIX}/${API_VERSION}` as const;

export const config = {
  appVersion: APP_VERSION,

  /**
   * Identity values only. Headlines, feature copy and the body of the legal documents stay in the
   * components that render them — this is the handful of values that would otherwise be repeated
   * across the header, the footer and both legal pages.
   */
  company: {
    productName: PRODUCT_NAME,
    /** The entity the terms are entered into with. Same as the product name until incorporated. */
    legalEntityName: PRODUCT_NAME,
    domain: PUBLIC_DOMAIN,
    repositoryUrl: REPOSITORY_URL,
    emails: {
      support: emailAddress("support", PUBLIC_DOMAIN),
      privacy: emailAddress("privacy", PUBLIC_DOMAIN),
      security: emailAddress("security", PUBLIC_DOMAIN),
    },
    legal: {
      /** Bump in the same change that edits either document — both pages read it from here. */
      effectiveDate: "2026-08-15",
      /** Placeholder: the real jurisdiction the entity is registered in must replace this. */
      governingLaw: "England and Wales",
    },
  },

  /** Service identities and their network defaults. Names appear in logs and health reports. */
  services: {
    api: {
      name: "api",
      defaultPort: API_PORT,
    },
    worker: {
      name: "worker",
      defaultHealthPort: WORKER_HEALTH_PORT,
      defaultConcurrency: 5,
      minConcurrency: 1,
      maxConcurrency: 100,
    },
    web: {
      name: "web",
      defaultPort: WEB_PORT,
      devServerPort: WEB_DEV_PORT,
      /** Where `bun run dev:web` sends `/api` when the API runs on the host. */
      defaultApiProxyTarget: httpUrl(LOCAL_HOST, API_PORT),
      staticRoot: "./dist",
      indexFile: "index.html",
      rootElementId: "root",
    },
    migrations: {
      name: "migrate",
      /** Resolved relative to `packages/db/src/`, where the migration runner lives. */
      folder: "../migrations",
    },
  },

  /** Shapes and bounds the environment loader validates against. */
  env: {
    nodeEnvs: ["development", "test", "production"],
    defaultNodeEnv: "development",
    logLevels: ["fatal", "error", "warn", "info", "debug", "trace"],
    defaultLogLevel: "info",
    port: {
      min: 1,
      max: 65_535,
    },
    /**
     * Connection strings are checked by scheme, so a URL pointing at the wrong kind of service
     * fails at startup rather than at first connect.
     */
    urlSchemes: {
      database: ["postgres", "postgresql"],
      redis: ["redis", "rediss"],
      api: ["http", "https"],
    },
    originListSeparator: ",",
  },

  http: {
    apiVersion: API_VERSION,
    basePath: API_BASE_PATH,
    routes: {
      /** Probed by the container platform. */
      health: HEALTH_PATH,
      /** The same report, reachable by the browser through the web app's proxy. */
      apiHealth: `${API_BASE_PATH}${HEALTH_PATH}`,
      flows: `${API_BASE_PATH}/flows`,
      apiProxyPrefix: API_PREFIX,
      apiProxyPattern: `${API_PREFIX}/*`,
      /** Browser telemetry is proxied through this app's origin, so the collector stays private. */
      otlpProxyPrefix: OTLP_PROXY_PREFIX,
      otlpProxyPattern: `${OTLP_PROXY_PREFIX}/*`,
      wildcard: "*",
      matchAll: "/*",
    },
    proxy: {
      /**
       * Headers that must not be forwarded to an upstream.
       *
       * `host` is the important one: it still names *this* origin, and any upstream behind a
       * CDN or reverse proxy that routes by Host will reject the request outright. The rest are
       * hop-by-hop headers (RFC 9110 §7.6.1) that describe the inbound connection, not the
       * request, plus `content-length`, which fetch recomputes for the forwarded body.
       */
      strippedRequestHeaders: [
        "host",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "upgrade",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "content-length",
      ],
    },
    cors: {
      allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowCredentials: true,
      /**
       * Both local front-end origins: the Vite dev server and the web container. Derived from the
       * port primitives, so changing a port cannot leave a stale origin behind here.
       */
      defaultOrigins: [httpUrl(LOCAL_HOST, WEB_DEV_PORT), httpUrl(LOCAL_HOST, WEB_PORT)],
    },
  },

  database: {
    /** Kept small: many API and worker replicas share one Postgres. */
    apiMaxConnections: 10,
    workerMaxConnections: 5,
    /** One connection, so concurrent deploys cannot race on the migrations table. */
    migrationMaxConnections: 1,
    /** Fail a health check quickly rather than letting a request hang on an unreachable DB. */
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  },

  redis: {
    /** Backoff with a ceiling, so a server restart does not produce a reconnect storm. */
    retryBackoffStepMs: 200,
    retryBackoffCeilingMs: 5_000,
    /** The API issues only short commands; a real outage should surface immediately. */
    apiMaxRetriesPerRequest: 1,
    /** Required by BullMQ: its blocking commands must not be aborted by a retry limit. */
    workerMaxRetriesPerRequest: null,
  },

  queue: {
    flowExecutions: {
      /**
       * The curly brackets are part of the queue name, not a template literal.
       *
       * Automend runs DragonflyDB as its Redis server, started with
       * `--cluster_mode=emulated --lock_on_hashtags`. That lets it lock at the {hashtag} level
       * instead of locking the whole store for BullMQ's Lua scripts. Every queue needs its own
       * hashtag, or all queues land on one thread and serialise behind each other.
       *
       * The braces are inert on stock Redis, so this name is correct on either server.
       */
      name: "{flow-executions}",
      jobName: "execute-flow",
    },
  },

  health: {
    /**
     * An unreachable dependency must make `/health` answer "down" promptly, rather than hanging
     * until the orchestrator's own probe timeout fires.
     */
    probeTimeoutMs: 3_000,
  },

  /**
   * OpenTelemetry log export. Automend ships logs to SigNoz, which is OTLP-native — the code
   * targets the OTLP protocol, not SigNoz specifically, so any OTLP backend works.
   */
  telemetry: {
    /** OTLP/HTTP rather than gRPC: it works unchanged from Node, Bun and the browser. */
    logsPath: "/v1/logs",
    otlpHttpPort: OTLP_HTTP_PORT,
    otlpGrpcPort: OTLP_GRPC_PORT,
    /**
     * Fallback only. Real deployments set OTEL_EXPORTER_OTLP_ENDPOINT to a remote collector, which
     * is why there is no host-vs-container split for it: a remote URL resolves the same from both.
     */
    defaultEndpoint: httpUrl(LOCAL_HOST, OTLP_HTTP_PORT),
    export: {
      /** Batch rather than per-record, so a log line never blocks a request. */
      maxQueueSize: 2_048,
      maxExportBatchSize: 512,
      scheduledDelayMs: 5_000,
    },
    /**
     * Log levels mapped onto OTel severity numbers, so SigNoz's severity filter works. Keyed by
     * label rather than by pino's numeric level, because the logger is configured to emit the
     * label — see `logging.emitLevelLabel`.
     * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
     */
    logLevelToSeverityNumber: {
      trace: 1,
      debug: 5,
      info: 9,
      warn: 13,
      error: 17,
      fatal: 21,
    },
    /** Log-record fields that pino owns; everything else becomes an OTel attribute. */
    reservedLogFields: ["level", "time", "msg", "pid", "hostname", "name"],
    browser: {
      /** Instrumentation scope name reported to the backend for browser-emitted records. */
      scopeName: "automend-web-browser",
      /** Kept short so a user closing the tab loses at most this much telemetry. */
      scheduledDelayMs: 2_000,
      maxExportBatchSize: 64,
    },
  },

  logging: {
    redactionCensor: "[redacted]",
    /**
     * Values that must never reach a log line, even at trace level. Centralised so a new call
     * site cannot accidentally opt out of redaction.
     */
    redactedPaths: [
      "DATABASE_URL",
      "REDIS_URL",
      "password",
      "token",
      "secret",
      "apiKey",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.accessToken",
      "*.refreshToken",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
  },

  validation: {
    flowName: {
      minLength: 1,
      maxLength: 200,
    },
    idempotencyKey: {
      minLength: 1,
      maxLength: 255,
    },
  },

  /** Browser-side defaults. Safe to import from React code — this module has no dependencies. */
  webClient: {
    routes: {
      home: HOME_ROUTE,
      status: STATUS_ROUTE,
      privacy: PRIVACY_ROUTE,
      terms: TERMS_ROUTE,
    },
    /** Deep-linkable anchors on the landing page — the header, the footer and the sections agree. */
    landingSections: {
      howItWorks: "how-it-works",
      features: "features",
      selfHosting: "self-hosting",
      faq: "faq",
    },
    defaultApiBasePath: API_BASE_PATH,
    queryStaleTimeMs: 10_000,
    queryRetryCount: 1,
    healthRefetchIntervalMs: 15_000,
    routerPreload: "intent",
  },

  /**
   * Values used only by the local development stack and by the `.env.example` generator.
   *
   * Application code must never read from here — it reads validated values from `env.ts`. This
   * exists so `docker-compose.yml` and `.env.example` derive from the same primitives as the code
   * instead of repeating them.
   */
  localDev: {
    host: LOCAL_HOST,
    postgres: {
      image: LOCAL_POSTGRES_IMAGE,
      containerPort: POSTGRES_CONTAINER_PORT,
      user: LOCAL_POSTGRES_USER,
      password: LOCAL_POSTGRES_PASSWORD,
      database: LOCAL_POSTGRES_DATABASE,
      dataPath: LOCAL_POSTGRES_DATA_PATH,
    },
    redis: {
      image: LOCAL_REDIS_IMAGE,
      containerPort: REDIS_CONTAINER_PORT,
    },
    /**
     * Two views of the same local services.
     *
     * `*FromHost` is for an app run with `bun run dev:*`; `*FromContainer` is for an app inside the
     * compose network, where `localhost` is the container itself. Both are only *defaults* — point
     * the matching variables in `.env` at a deployed database and everything follows.
     */
    urls: {
      database: postgresUrl({
        host: LOCAL_HOST,
        port: POSTGRES_CONTAINER_PORT,
        user: LOCAL_POSTGRES_USER,
        password: LOCAL_POSTGRES_PASSWORD,
        database: LOCAL_POSTGRES_DATABASE,
      }),
      databaseFromContainer: postgresUrl({
        host: LOCAL_POSTGRES_SERVICE,
        port: POSTGRES_CONTAINER_PORT,
        user: LOCAL_POSTGRES_USER,
        password: LOCAL_POSTGRES_PASSWORD,
        database: LOCAL_POSTGRES_DATABASE,
      }),
      redis: redisUrl(LOCAL_HOST, REDIS_CONTAINER_PORT),
      redisFromContainer: redisUrl(LOCAL_REDIS_SERVICE, REDIS_CONTAINER_PORT),
      api: httpUrl(LOCAL_HOST, API_PORT),
    },
  },
} as const;

export type AutomendConfig = typeof config;
