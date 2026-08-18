import { type Auth, type ConnectorCredentialMap, createAuth } from "@automend/auth";
import { createDatabaseClient, type Database } from "@automend/db";
import { config } from "@automend/shared";
import { parseMasterKey } from "@automend/shared/crypto";
import { createLogger, type Logger } from "@automend/shared/logger";
import { startLogTelemetry, type Telemetry } from "@automend/shared/telemetry";
import { Redis } from "ioredis";
import { env, serviceConfig } from "./config";

export type WorkerDependencies = {
  db: Database;
  redis: Redis;
  /**
   * Better-Auth, for the one thing the worker needs from it: a live OAuth access token.
   *
   * `getAccessToken` refreshes an expired one, which is why the worker holds this rather than reading the token
   * columns itself — a stale token handed to a kit fails upstream for a reason nobody can diagnose.
   */
  auth: Auth;
  /** Decrypts token connections. Held as bytes so the key is parsed and checked exactly once, at start-up. */
  secretsKey: Buffer;
  /**
   * Whether flows may call private and loopback addresses.
   *
   * Off by default, because an HTTP step's URL can come from a flow's *data* — so whoever sends a webhook would
   * otherwise choose where the worker connects. On for a deployment that genuinely automates against a service on
   * its own network. Link-local stays refused either way; that is where instance metadata lives.
   */
  allowPrivateNetwork: boolean;
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

/**
 * Credentials for the services flows act through, keyed by connector id.
 *
 * The same variables the API reads, deliberately: `getAccessToken` refreshes through the provider's token endpoint
 * and needs the client pair, so a worker configured differently from the API would refresh nothing. A connector
 * whose credentials are unset simply cannot be refreshed, and the run that needed it fails saying so.
 */
function readConnectorCredentials(): ConnectorCredentialMap {
  const credentials: ConnectorCredentialMap = {};
  const configured = {
    google: readCredentialPair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    slack: readCredentialPair(env.SLACK_CLIENT_ID, env.SLACK_CLIENT_SECRET),
    discord: readCredentialPair(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
  };

  for (const [connectorId, pair] of Object.entries(configured)) {
    if (pair) {
      credentials[connectorId] = pair;
    }
  }

  return credentials;
}

/** A provider is offered only when both halves of its pair are present, so a half-configured one is absent. */
function readCredentialPair(clientId: string | undefined, clientSecret: string | undefined) {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
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

  /**
   * Constructed with no social providers and no trusted origins: the worker serves no requests, so nothing here is
   * a sign-in surface. It exists for `getAccessToken` alone, which needs the connector credentials and the secret
   * the tokens were sealed with.
   */
  const auth = createAuth({
    db: database.db,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_BASE_URL,
    trustedOrigins: [],
    connectors: readConnectorCredentials(),
    onHookError: (error, context) => logger.error({ err: error, ...context }, "auth hook failed in the worker"),
  });

  async function closeClients(): Promise<void> {
    await Promise.allSettled([database.close(), redis.quit()]);
    // Flushed last, so the shutdown records themselves reach the collector.
    await telemetry?.shutdown();
  }

  return {
    db: database.db,
    redis,
    auth,
    secretsKey: parseMasterKey(env.SECRETS_KEY),
    allowPrivateNetwork: env.ENGINE_ALLOW_PRIVATE_NETWORK,
    logger,
    closeClients,
  };
}
