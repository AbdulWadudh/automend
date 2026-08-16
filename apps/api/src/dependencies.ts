/**
 * Builds the long-lived clients the API needs and exposes a single shutdown hook for them.
 *
 * Everything is constructed once and passed explicitly into route factories, so tests can supply
 * their own doubles without reaching for module mocking.
 */

import { createDatabaseClient, type Database } from "@automend/db";
import {
  type Auth,
  type ConnectorCredentialMap,
  createAuth,
  listAvailableConnectors,
  type SocialProviderCredentials,
} from "@automend/auth";
import { config } from "@automend/shared";
import { createLogger, type Logger } from "@automend/shared/logger";
import { startLogTelemetry, type Telemetry } from "@automend/shared/telemetry";
import { Redis } from "ioredis";
import { env, serviceConfig } from "./config";

export type ApiDependencies = {
  db: Database;
  redis: Redis;
  auth: Auth;
  /** The social providers this deployment configured, for the sign-in page to render. */
  enabledSocialProviders: string[];
  logger: Logger;
  allowedOrigins: string[];
  shutdown: () => Promise<void>;
};

function createRedisClient(logger: Logger): Redis {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: config.redis.apiMaxRetriesPerRequest,
    retryStrategy: (attempt) => Math.min(attempt * config.redis.retryBackoffStepMs, config.redis.retryBackoffCeilingMs),
  });

  // ioredis emits 'error' on every failed reconnect; an unhandled 'error' event would take the
  // whole process down, so it is always logged and swallowed here.
  redis.on("error", (error) => {
    logger.warn({ err: error }, "redis connection error");
  });

  return redis;
}

/**
 * A provider is offered only when both halves of its credential pair are present, so a deployment
 * that has not set them up yet starts normally with the button hidden rather than failing at the
 * redirect.
 */
function readGoogleCredentials(): SocialProviderCredentials | undefined {
  return readCredentialPair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

function readCredentialPair(
  clientId: string | undefined,
  clientSecret: string | undefined,
): SocialProviderCredentials | undefined {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * Both the origins allowed to call the API and the origin OAuth redirects come back to. They are
 * normally the same address, but a deployment can serve several front-ends from one API.
 */
function collectTrustedOrigins(): string[] {
  return [...new Set([...env.WEB_ORIGIN, env.AUTH_BASE_URL])];
}

function startTelemetry(): Telemetry | undefined {
  if (!env.OTEL_LOGS_ENABLED) {
    return undefined;
  }

  return startLogTelemetry({
    serviceName: serviceConfig.name,
    serviceVersion: config.appVersion,
    environment: env.NODE_ENV,
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: env.OTEL_EXPORTER_OTLP_HEADERS,
  });
}

export function createApiDependencies(): ApiDependencies {
  const telemetry = startTelemetry();
  const logger = createLogger({
    service: serviceConfig.name,
    level: env.LOG_LEVEL,
    otelLogger: telemetry?.logger,
  });
  const database = createDatabaseClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: config.database.apiMaxConnections,
  });
  const redis = createRedisClient(logger);
  const google = readGoogleCredentials();
  const auth = createAuth({
    db: database.db,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_BASE_URL,
    trustedOrigins: collectTrustedOrigins(),
    google,
    // Hooks run outside the request they were triggered by, so a failure has nowhere else to
    // surface. Logged rather than thrown: a workspace that was not created is recoverable.
    onHookError: (error, context) => logger.error({ err: error, ...context }, "auth hook failed"),
  });


  async function shutdown(): Promise<void> {
    await Promise.allSettled([database.close(), redis.quit()]);
    // Flushed last, so records emitted while closing the other clients are still exported.
    await telemetry?.shutdown();
  }

  return {
    db: database.db,
    redis,
    auth,
    enabledSocialProviders: google ? [config.auth.socialProviders.google.id] : [],
    logger,
    allowedOrigins: env.WEB_ORIGIN,
    shutdown,
  };
}
