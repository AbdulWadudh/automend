/**
 * The single typed configuration module for every server-side process.
 *
 * Each app calls its own loader once, at module scope, so a misconfigured deployment crashes
 * immediately with a readable message instead of failing later on the first request.
 *
 * Every default, bound and allowed value here comes from `config.ts` — this module decides *how*
 * configuration is validated, never *what* the values are.
 *
 * The browser bundle does NOT use this module — Vite replaces `import.meta.env` at build time and
 * there is no `process.env` to read, so the web app validates separately in `src/lib/env.ts`.
 */

import { z } from "zod";
import { config } from "./config";
import { envValidationError } from "./errors";

/** `"true"`/`"false"` rather than any truthy string, so a typo fails loudly instead of silently. */
const booleanSchema = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * The OTel convention for extra headers: `key=value,key2=value2`. Self-hosted SigNoz needs none;
 * a hosted backend usually wants an ingestion key here.
 */
const otlpHeadersSchema = z
  .string()
  .default("")
  .transform((value) => {
    const headers: Record<string, string> = {};

    for (const pair of value.split(",")) {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex > 0) {
        headers[pair.slice(0, separatorIndex).trim()] = pair.slice(separatorIndex + 1).trim();
      }
    }

    return headers;
  });

/**
 * Telemetry settings every service shares. Log export is on by default so a new deployment is
 * observable without extra configuration, and can be switched off for tests or an air-gapped run.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(config.env.nodeEnvs).default(config.env.defaultNodeEnv),
  LOG_LEVEL: z.enum(config.env.logLevels).default(config.env.defaultLogLevel),
  OTEL_LOGS_ENABLED: booleanSchema.default(true),
  OTEL_EXPORTER_OTLP_ENDPOINT: connectionUrlSchema("OTEL_EXPORTER_OTLP_ENDPOINT", config.env.urlSchemes.api).default(
    config.telemetry.defaultEndpoint,
  ),
  OTEL_EXPORTER_OTLP_HEADERS: otlpHeadersSchema,
});

/**
 * Connection strings are checked by scheme rather than by generic URL parsing, so a value that
 * points at the wrong kind of service fails at startup instead of at first connect.
 */
function connectionUrlSchema(variableName: string, allowedSchemes: readonly string[]) {
  return z
    .string()
    .min(1)
    .refine((value) => allowedSchemes.some((scheme) => value.startsWith(`${scheme}://`)), {
      message: `${variableName} must start with ${allowedSchemes.map((s) => `${s}://`).join(" or ")}`,
    });
}

const databaseUrlSchema = connectionUrlSchema("DATABASE_URL", config.env.urlSchemes.database);

/**
 * Named for the protocol, not the server. Automend deploys DragonflyDB behind this URL, but it is
 * Redis-wire-compatible and reached with the ordinary ioredis client, so no application code needs
 * to know which implementation is running. See the Redis notes in CLAUDE.md for the Dragonfly-
 * specific server flags and queue-naming requirements.
 */
const redisUrlSchema = connectionUrlSchema("REDIS_URL", config.env.urlSchemes.redis);

const portSchema = z.coerce.number().int().min(config.env.port.min).max(config.env.port.max);

/** `WEB_ORIGIN` is a comma-separated list so a single deployment can serve several front-ends. */
const originListSchema = z
  .string()
  .default(config.http.cors.defaultOrigins.join(config.env.originListSeparator))
  .transform((value) =>
    value
      .split(config.env.originListSeparator)
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );

const databaseEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseUrlSchema,
});

/**
 * Present and non-empty, or absent. An OAuth provider is enabled only when *both* halves of its
 * credential pair are supplied, so a half-configured provider is treated as switched off rather
 * than failing at the redirect.
 */
const optionalSecretSchema = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

/**
 * The queue dashboard's password.
 *
 * Optional, because the dashboard is simply not mounted without one — but a *short* one is refused
 * rather than accepted. The usual "half-configured counts as off" treatment would let a five
 * character password stand as the only guard on a console that can read every tenant's job
 * payloads, so the length is checked even though the variable itself may be absent.
 */
const opsDashboardPasswordSchema = optionalSecretSchema.refine(
  (value) => value === undefined || value.length >= config.ops.queueDashboard.passwordMinLength,
  {
    message: `OPS_DASHBOARD_PASSWORD must be at least ${config.ops.queueDashboard.passwordMinLength} characters`,
  },
);

/**
 * An absent URL, or one that is genuinely a URL of the expected scheme. Absent is a valid answer —
 * every caller of this treats it as "this deployment does not have that thing".
 */
function optionalUrlSchema(variableName: string, allowedSchemes: readonly string[]) {
  return z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine((value) => value === undefined || allowedSchemes.some((scheme) => value.startsWith(`${scheme}://`)), {
      message: `${variableName} must start with ${allowedSchemes.map((scheme) => `${scheme}://`).join(" or ")}`,
    });
}

const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  /**
   * The api reads this too, and it must be the same value the worker has.
   *
   * Loading a dynamic dropdown's options is a kit calling a service through the same guarded client a
   * step uses, so the address rules have to be the deployment's rather than a second, looser set that
   * happens to live in the api. See the worker's entry below for why it is off by default.
   */
  ENGINE_ALLOW_PRIVATE_NETWORK: booleanSchema.default(config.engine.http.allowPrivateNetworkByDefault),
  API_PORT: portSchema.default(config.services.api.defaultPort),
  WEB_ORIGIN: originListSchema,
  AUTH_SECRET: z
    .string()
    .min(config.auth.secretMinLength, `AUTH_SECRET must be at least ${config.auth.secretMinLength} characters`),
  /**
   * The origin the *browser* uses, not the API's own address: OAuth callback URLs are built from
   * it and the browser reaches the API through the web app's proxy. It is also what must be
   * registered as the redirect URI with each provider.
   */
  AUTH_BASE_URL: connectionUrlSchema("AUTH_BASE_URL", config.env.urlSchemes.api).default(config.localDev.urls.webDev),
  /**
   * Encrypts connector secrets at rest. Separate from AUTH_SECRET on purpose: they protect
   * different things with different lifetimes, and rotating a session key must not make every
   * stored API token unreadable.
   */
  SECRETS_KEY: z.string().min(1, "SECRETS_KEY is required — generate one with: openssl rand -base64 32"),
  GOOGLE_CLIENT_ID: optionalSecretSchema,
  GOOGLE_CLIENT_SECRET: optionalSecretSchema,
  SLACK_CLIENT_ID: optionalSecretSchema,
  SLACK_CLIENT_SECRET: optionalSecretSchema,
  DISCORD_CLIENT_ID: optionalSecretSchema,
  DISCORD_CLIENT_SECRET: optionalSecretSchema,
  /**
   * Credentials for the queue dashboard, and the switch that turns it on.
   *
   * Both halves or neither: with either missing the dashboard is not mounted, so a deployment that
   * has not decided about it is closed rather than open. The api logs which of the two it was
   * missing, because the alternative symptom is a 404 on a route the operator believes exists.
   */
  OPS_DASHBOARD_USER: optionalSecretSchema,
  OPS_DASHBOARD_PASSWORD: opsDashboardPasswordSchema,
  /**
   * The database studio's public address, which only the deployment knows.
   *
   * The studio runs on its own origin — Drizzle Gateway serves its assets from the root, so it cannot
   * be proxied under a path prefix the way the queue dashboard is — and it is deliberately *not*
   * defaulted. A default would put a link to `localhost` in every user's sidebar on a deployment that
   * forgot to set it, and an address the browser cannot reach is worse than no link at all.
   */
  STUDIO_URL: optionalUrlSchema("STUDIO_URL", config.env.urlSchemes.api),
});

/**
 * The web container serves the built bundle and proxies `/api` onwards, so the API address is a
 * runtime value there — it is never compiled into the JavaScript that reaches the browser.
 */
const webServerEnvSchema = baseEnvSchema.extend({
  WEB_PORT: portSchema.default(config.services.web.defaultPort),
  API_URL: connectionUrlSchema("API_URL", config.env.urlSchemes.api),
});

const workerEnvSchema = baseEnvSchema.extend({
  /**
   * The same variables the API reads, not copies of them.
   *
   * Resolving a connection's OAuth token goes through Better-Auth, which refreshes it against the provider — and
   * refreshing needs the client pair, the signing secret the tokens were sealed with, and the base URL the
   * redirect URIs were registered under. A worker given different values from the API would decrypt nothing.
   */
  AUTH_SECRET: z
    .string()
    .min(config.auth.secretMinLength, `AUTH_SECRET must be at least ${config.auth.secretMinLength} characters`),
  /**
   * The same variable the API reads, with the same default — not a second name for it.
   *
   * Better-Auth builds provider redirect URIs from this, and a refresh that presents a different one is refused, so
   * the worker and the API have to agree. Defaulted rather than required so a laptop needs no extra configuration.
   */
  AUTH_BASE_URL: connectionUrlSchema("AUTH_BASE_URL", config.env.urlSchemes.api).default(config.localDev.urls.webDev),
  GOOGLE_CLIENT_ID: optionalSecretSchema,
  GOOGLE_CLIENT_SECRET: optionalSecretSchema,
  SLACK_CLIENT_ID: optionalSecretSchema,
  SLACK_CLIENT_SECRET: optionalSecretSchema,
  DISCORD_CLIENT_ID: optionalSecretSchema,
  DISCORD_CLIENT_SECRET: optionalSecretSchema,
  /** Decrypts token connections. The same key the API sealed them with. */
  SECRETS_KEY: z.string().min(1, "SECRETS_KEY is required — generate one with: openssl rand -base64 32"),
  /**
   * Lets flows call private, loopback and internal addresses.
   *
   * Off by default and deliberately so: an HTTP step's URL can come from a flow's *data*, so whoever sends a
   * webhook would otherwise choose where the worker connects — reaching Postgres, Redis, or anything else on the
   * network. Turn it on only for a deployment that genuinely automates against a service on its own network.
   * Link-local (`169.254.0.0/16`, `fe80::/10`) stays refused either way, because that is where cloud instance
   * metadata — and the machine's own credentials — live.
   */
  ENGINE_ALLOW_PRIVATE_NETWORK: booleanSchema.default(config.engine.http.allowPrivateNetworkByDefault),
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  WORKER_HEALTH_PORT: portSchema.default(config.services.worker.defaultHealthPort),
  WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(config.services.worker.minConcurrency)
    .max(config.services.worker.maxConcurrency)
    .default(config.services.worker.defaultConcurrency),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

type EnvSource = Record<string, string | undefined>;

function describeInvalidEnv(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const variableName = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${variableName}: ${issue.message}`;
  });

  return `Invalid environment configuration:\n${lines.join("\n")}`;
}

/**
 * Parses `source` against `schema`, reporting every problem at once. The message never echoes the
 * offending values, because they may be secrets.
 */
function parseEnv<Schema extends z.ZodType>(schema: Schema, source: EnvSource): z.infer<Schema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw envValidationError(describeInvalidEnv(result.error));
  }

  return result.data;
}

export function loadDatabaseEnv(source: EnvSource = process.env): DatabaseEnv {
  return parseEnv(databaseEnvSchema, source);
}

export function loadApiEnv(source: EnvSource = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}

export function loadWebServerEnv(source: EnvSource = process.env): WebServerEnv {
  return parseEnv(webServerEnvSchema, source);
}

export function loadWorkerEnv(source: EnvSource = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
