/**
 * Builds the long-lived clients the API needs and exposes a single shutdown hook for them.
 *
 * Everything is constructed once and passed explicitly into route factories, so tests can supply
 * their own doubles without reaching for module mocking.
 */

import { createDatabaseClient, type Database } from "@automend/db";
import { config } from "@automend/shared";
import { createLogger, type Logger } from "@automend/shared/logger";
import { startLogTelemetry, type Telemetry } from "@automend/shared/telemetry";
import { Redis } from "ioredis";
import { env, serviceConfig } from "./config";

export type ApiDependencies = {
  db: Database;
  redis: Redis;
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

  async function shutdown(): Promise<void> {
    await Promise.allSettled([database.close(), redis.quit()]);
    // Flushed last, so records emitted while closing the other clients are still exported.
    await telemetry?.shutdown();
  }

  return {
    db: database.db,
    redis,
    logger,
    allowedOrigins: env.WEB_ORIGIN,
    shutdown,
  };
}
