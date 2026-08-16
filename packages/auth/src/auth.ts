/**
 * The Better-Auth instance, built once per process.
 *
 * This lives in a package rather than inside `apps/api` because the API is not its only consumer.
 * Flow steps will authenticate against third-party services with OAuth tokens Better-Auth already
 * stores and refreshes (`auth.api.getAccessToken`), and those calls happen in the *worker*, which
 * has no HTTP session. Both processes therefore need to build the same instance.
 *
 * Nothing here reads `process.env`: every value arrives as an argument, so the caller's typed
 * environment module stays the single place configuration is validated.
 */

import type { Database } from "@automend/db";
import { findOldestOrganizationIdForUser } from "@automend/db";
import * as schema from "@automend/db/schema";
import { config } from "@automend/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { type ConnectorCredentialMap, createConnectorPlugin } from "./connectors";
import { authSchemaOptions } from "./options";
import { buildPersonalWorkspaceName, buildWorkspaceSlug } from "./workspace";

export type SocialProviderCredentials = {
  clientId: string;
  clientSecret: string;
};

export type CreateAuthOptions = {
  db: Database;
  /** Signs session cookies and encrypts stored OAuth tokens. */
  secret: string;
  /**
   * The origin the browser uses, which is what provider redirect URIs are built from. It is never
   * the API's own address: the browser reaches the API through the web app's proxy.
   */
  baseUrl: string;
  trustedOrigins: string[];
  /** Omit to hide the provider's button — a deployment with no credentials must still start. */
  google?: SocialProviderCredentials;
  /**
   * Credentials for the services flows act *through*, keyed by connector id. Kept apart from
   * `google` above even where the same OAuth app is used: connecting asks for far broader scopes
   * than signing in, and the two must not share an account row.
   */
  connectors?: ConnectorCredentialMap;
  /** Reports a background hook failure; a hook must never take the request that triggered it down. */
  onHookError?: (error: unknown, context: Record<string, unknown>) => void;
};

const { auth: authConfig } = config;

/**
 * Lets the sign-up hook call back into the instance that owns it.
 *
 * Typed as just the one endpoint it needs rather than as the whole instance, because
 * `ReturnType<typeof createAuth>` cannot refer to itself while it is still being inferred.
 */
type CreateOrganizationCall = (input: { body: { name: string; slug: string; userId: string } }) => Promise<unknown>;

function buildSocialProviders(options: CreateAuthOptions) {
  if (!options.google) {
    return {};
  }

  return {
    [authConfig.socialProviders.google.id]: {
      clientId: options.google.clientId,
      clientSecret: options.google.clientSecret,
    },
  };
}

export function createAuth(options: CreateAuthOptions) {
  const pending: { createOrganization?: CreateOrganizationCall } = {};

  function reportHookFailure(error: unknown, context: Record<string, unknown>): void {
    options.onHookError?.(error, context);
  }

  const connectorPlugin = createConnectorPlugin(options.connectors ?? {});

  const instance = betterAuth({
    // Everything that decides the database shape lives in `options.ts`, so the committed schema
    // and the running server can never describe different tables.
    ...authSchemaOptions,

    // Connector providers are added per deployment rather than in `options.ts`, because they
    // depend on which credentials are set. They add no tables of their own — generic OAuth
    // accounts live in the same `account` table — so the committed schema is unaffected.
    plugins: connectorPlugin ? [...authSchemaOptions.plugins, connectorPlugin] : authSchemaOptions.plugins,

    baseURL: options.baseUrl,
    basePath: authConfig.basePath,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,

    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema,
    }),

    socialProviders: buildSocialProviders(options),

    databaseHooks: {
      user: {
        create: {
          /**
           * A flow cannot be stored without a tenant to scope it to, so the first workspace is
           * created with the account rather than on first use.
           *
           * Called without headers on purpose: Better-Auth treats a headerless call carrying a
           * `userId` as a system action and skips the session check, which is what this is.
           */
          after: async (user) => {
            try {
              await pending.createOrganization?.({
                body: {
                  name: buildPersonalWorkspaceName(user.name),
                  slug: buildWorkspaceSlug(user.name || user.email),
                  userId: user.id,
                },
              });
            } catch (error) {
              // Swallowed so a workspace failure cannot abort an otherwise valid sign-up. The
              // API's tenant middleware creates the missing workspace on the next request.
              reportHookFailure(error, { hook: "user.create.after", userId: user.id });
            }
          },
        },
      },
      session: {
        create: {
          /**
           * Stamps the session with a workspace so an ordinary request needs no membership lookup
           * to know its tenant. A user with no workspace yet is handled by the tenant middleware.
           */
          before: async (session) => {
            try {
              const organizationId = await findOldestOrganizationIdForUser(options.db, session.userId);

              if (!organizationId) {
                return;
              }

              return { data: { ...session, activeOrganizationId: organizationId } };
            } catch (error) {
              reportHookFailure(error, { hook: "session.create.before", userId: session.userId });
              return;
            }
          },
        },
      },
    },
  });

  pending.createOrganization = (input) => instance.api.createOrganization(input);

  return instance;
}

export type Auth = ReturnType<typeof createAuth>;
