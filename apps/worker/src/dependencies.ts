import { createDatabaseClient, type Database } from "@automend/db";
import { config } from "@automend/shared";
import { createLogger, type Logger } from "@automend/shared/logger";
import { startLogTelemetry, type Telemetry } from "@automend/shared/telemetry";
import { Redis } from "ioredis";
import { env, serviceConfig } from "./config";

export type WorkerDependencies = {
  db: Database;
  redis: Redis;
  logger: Logger;
  closeClients: () => Promise<void>;
};

function createRedisClient(logger: Logger): Redis {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: config.redis.workerMaxRetriesPerRequest,
    retryStrategy: (attempt) => Math.min(attempt * config.redis.retryBackoffStepMs, config.redis.retryBackoffCeilingMs),
  });

  // An unhandled 'error' event would terminate the worker process, losing in-flight jobs.
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

export function createWorkerDependencies(): WorkerDependencies {
  const telemetry = startTelemetry();
  const logger = createLogger({
    service: serviceConfig.name,
    level: env.LOG_LEVEL,
    otelLogger: telemetry?.logger,
  });
  const database = createDatabaseClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: config.database.workerMaxConnections,
  });
  const redis = createRedisClient(logger);

  async function closeClients(): Promise<void> {
    await Promise.allSettled([database.close(), redis.quit()]);
    // Flushed last, so the shutdown records themselves reach the collector.
    await telemetry?.shutdown();
  }

  return { db: database.db, redis, logger, closeClients };
}
