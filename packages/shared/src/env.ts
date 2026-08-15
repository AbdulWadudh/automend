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

const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  API_PORT: portSchema.default(config.services.api.defaultPort),
  WEB_ORIGIN: originListSchema,
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
