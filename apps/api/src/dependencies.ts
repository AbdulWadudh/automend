/**
 * Builds the long-lived clients the API needs and exposes a single shutdown hook for them.
 *
 * Everything is constructed once and passed explicitly into route factories, so tests can supply
 * their own doubles without reaching for module mocking.
 */

import {
  type Auth,
  type ConnectorCredentialMap,
  createAuth,
  listAvailableConnectors,
  type SocialProviderCredentials,
} from "@automend/auth";
import { createDatabaseClient, type Database, findLinkedAccountForUser, type LinkedAccount } from "@automend/db";
import { config } from "@automend/shared";
import { parseMasterKey } from "@automend/shared/crypto";
import { createLogger, type Logger } from "@automend/shared/logger";
import { startLogTelemetry, type Telemetry } from "@automend/shared/telemetry";
import { Redis } from "ioredis";
import { env, serviceConfig } from "./config";
import { createOpsSession, type OpsSession } from "./http/ops-session";

export type ApiDependencies = {
  db: Database;
  redis: Redis;
  auth: Auth;
  /** The social providers this deployment configured, for the sign-in page to render. */
  enabledSocialProviders: string[];
  /** The connectors this deployment can offer, for the connections dashboard to render. */
  availableConnectors: string[];
  /** Encrypts connector secrets. Held as bytes so the key is parsed and checked exactly once. */
  secretsKey: Buffer;
  /**
   * Checks the operator password and issues the grant the queue dashboard looks for, or `undefined`
   * when this deployment configured no operator credentials.
   *
   * Undefined is the normal state, and it is the single fact that decides everything downstream: the
   * dashboard is not mounted and the Operations page reports the console as unavailable. See
   * `http/ops-session.ts` for what the password admits.
   */
  opsSession: OpsSession | undefined;
  /**
   * The database studio's public address, or undefined when this deployment has none.
   *
   * Only the deployment knows it: the studio runs on its own origin, so unlike the queue dashboard's
   * path there is nothing to derive it from. Undefined means the Operations page reports it as
   * unavailable rather than offering a link the browser cannot follow.
   */
  studioUrl: string | undefined;
  findLinkedAccount: (userId: string, providerId: string) => Promise<LinkedAccount | undefined>;
  /** Who a linked account belongs to, asked of the provider. Undefined if it cannot be reached. */
  fetchAccountProfile: (
    userId: string,
    providerId: string,
    accountId: string,
  ) => Promise<{ email: string | null; name: string | null } | undefined>;
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
 * Credentials for the services flows act through, keyed by connector id.
 *
 * Google appears here as well as in the sign-in providers above, and on purpose: the same OAuth
 * application, registered twice under different provider ids, so that connecting Google for
 * automation cannot widen what signing in with Google is allowed to do.
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

/**
 * The operator session, and `undefined` for "the consoles are off".
 *
 * A half-configured pair is off, matching how a connector's credentials are read — but unlike a
 * connector it is warned about, because the symptom is a console the operator just configured
 * reporting itself unavailable, with nothing to suggest which half went missing.
 */
function createOperatorSession(logger: Logger): OpsSession | undefined {
  const username = env.OPS_DASHBOARD_USER;
  const password = env.OPS_DASHBOARD_PASSWORD;

  if (username && password) {
    return createOpsSession({
      password,
      signingSecret: env.AUTH_SECRET,
      // The origin the *browser* uses, which is the connection the cookie actually travels over.
      secureCookie: env.AUTH_BASE_URL.startsWith("https://"),
    });
  }

  if (username || password) {
    logger.warn(
      { missing: username ? "OPS_DASHBOARD_PASSWORD" : "OPS_DASHBOARD_USER" },
      "the operator consoles need both halves of the credentials and stay off with one",
    );
  }

  return undefined;
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
  const connectors = readConnectorCredentials();
  // Parsed once, at startup: a malformed key must stop the process rather than surface later as a
  // failure to save someone's API token.
  const secretsKey = parseMasterKey(env.SECRETS_KEY);

  const auth = createAuth({
    db: database.db,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_BASE_URL,
    trustedOrigins: collectTrustedOrigins(),
    google,
    connectors,
    // Hooks run outside the request they were triggered by, so a failure has nowhere else to
    // surface. Logged rather than thrown: a workspace that was not created is recoverable.
    onHookError: (error, context) => logger.error({ err: error, ...context }, "auth hook failed"),
  });

  const availableConnectors = listAvailableConnectors(connectors);

  logger.info(
    { authBaseUrl: env.AUTH_BASE_URL, googleSignInEnabled: Boolean(google), availableConnectors },
    "authentication configured",
  );

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
    availableConnectors,
    secretsKey,
    opsSession: createOperatorSession(logger),
    studioUrl: env.STUDIO_URL,
    findLinkedAccount: (userId, providerId) => findLinkedAccountForUser(database.db, userId, providerId),
    fetchAccountProfile: async (userId, providerId, accountId) => {
      try {
        // Goes out to the provider with a token Better-Auth refreshes if needed — the same call
        // the execution engine will make. Failing it must not fail the connection: a workspace
        // that authorised a service is connected whether or not we could fetch a label for it.
        const info = await auth.api.accountInfo({ query: { accountId, providerId, userId } });

        return { email: info?.user.email ?? null, name: info?.user.name ?? null };
      } catch (error) {
        logger.warn({ err: error, providerId }, "could not read the connected account's profile");
        return undefined;
      }
    },
    logger,
    allowedOrigins: env.WEB_ORIGIN,
    shutdown,
  };
}
