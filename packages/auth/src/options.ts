/**
 * The half of the Better-Auth configuration that decides what the database must look like.
 *
 * It is separated from `createAuth` because the schema generator needs exactly this and nothing
 * else: no database handle, no secret, no provider credentials. That keeps
 * `scripts/generate-auth-schema.ts` free of any import cycle through `@automend/db`, and — more
 * importantly — means the committed schema is derived from the same object the running server
 * uses, so enabling a plugin cannot change one without the other.
 */

import { config } from "@automend/shared";
import { organization } from "better-auth/plugins";

const { auth: authConfig, validation } = config;

export const authSchemaOptions = {
  emailAndPassword: {
    enabled: true,
    minPasswordLength: validation.password.minLength,
    maxPasswordLength: validation.password.maxLength,
    /** Signed in straight after sign-up: there is no email verification step to wait for yet. */
    autoSignIn: true,
  },

  account: {
    /**
     * AES-256-GCM at rest, per the platform's secrets rule. It matters more here than for a plain
     * login: these same rows will hold the tokens flow steps act with.
     */
    encryptOAuthTokens: true,
    accountLinking: {
      /**
       * A connected service rarely shares an address with the person connecting it — a shared
       * `ops@` mailbox or a team Slack is the normal case, not the exception. Without this,
       * connecting one fails with `email_doesn't_match`.
       *
       * This is not the account-takeover risk it sounds like: linking always happens from inside
       * an authenticated session, so it can only ever attach an account to the user who is already
       * signed in. The dangerous direction — *signing in* and being matched to an existing account
       * by an unverified email — is governed separately, by `trustedProviders`.
       */
      allowDifferentEmails: true,
    },
  },

  session: {
    expiresIn: authConfig.session.expiresInSeconds,
    updateAge: authConfig.session.updateAgeSeconds,
    cookieCache: {
      enabled: true,
      maxAge: authConfig.session.cookieCacheSeconds,
    },
  },

  advanced: {
    database: {
      /**
       * Every identifier in this database is a UUID, including the ones Better-Auth owns, so
       * `flows.tenant_id` can be a real foreign key to `organization.id` rather than a loosely
       * typed string. Better-Auth treats an id as opaque, so the shape is ours to choose.
       */
      generateId: () => crypto.randomUUID(),
    },
  },

  plugins: [
    organization({
      creatorRole: authConfig.organization.creatorRole,
    }),
  ],
};
