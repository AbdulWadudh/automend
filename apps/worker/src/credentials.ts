/**
 * Turning a step's `connectionId` into something a kit can act with.
 *
 * This is where the secrets key is used, and it stays in the parent process for exactly that reason. The engine
 * subprocess receives the *result* — one access token, for one step — rather than the means to produce more.
 *
 * Two kinds of connection, resolved differently:
 *
 * - **token** — the secret is in our own `connections` row, envelope-encrypted. Decrypted here.
 * - **oauth** — the tokens belong to Better-Auth, which already stores and refreshes them. `getAccessToken`
 *   returns a live one, refreshing it if it has expired, so the worker never handles a refresh token and never
 *   hands an expired access token to a kit.
 */

import { type Auth, toConnectionProviderId } from "@automend/auth";
import { type Database, findConnectionForTenant, findConnectionSecret } from "@automend/db";
import { findKit } from "@automend/kits";
import { type FlowDefinition, stepExecutionError } from "@automend/shared";
import { decryptSecret } from "@automend/shared/crypto";
import type { EngineCredential } from "./engine/protocol";

export type ResolveCredentialsOptions = {
  db: Database;
  auth: Auth;
  secretsKey: Buffer;
  tenantId: string;
  definition: FlowDefinition;
};

export type ResolvedCredentials =
  | { ok: true; credentials: Map<string, EngineCredential> }
  /** Named so the run's failure says which step, and what to do about it. */
  | { ok: false; stepId: string; stepName: string; message: string };

/**
 * Every credential this run needs, keyed by step id.
 *
 * Resolved up front rather than per step, so a run that cannot get one of its credentials fails before it has
 * done half its work. A flow that sends an email and then posts to Slack should not send the email if the Slack
 * connection was revoked — the partial run is the worse outcome, because it is the one nobody can undo.
 */
export async function resolveRunCredentials(options: ResolveCredentialsOptions): Promise<ResolvedCredentials> {
  const { db, auth, secretsKey, tenantId, definition } = options;
  const credentials = new Map<string, EngineCredential>();

  for (const step of definition.steps) {
    const kit = findKit(step.kitId);

    if (!kit?.auth) {
      continue;
    }

    if (step.connectionId === undefined) {
      return {
        ok: false,
        stepId: step.id,
        stepName: step.name,
        message: `"${step.name}" needs a ${kit.displayName} connection, and none is chosen`,
      };
    }

    try {
      credentials.set(step.id, await resolveOne(db, auth, secretsKey, tenantId, step.connectionId));
    } catch (error) {
      return {
        ok: false,
        stepId: step.id,
        stepName: step.name,
        message: `"${step.name}" could not use its ${kit.displayName} connection — ${(error as Error).message}`,
      };
    }
  }

  return { ok: true, credentials };
}

async function resolveOne(
  db: Database,
  auth: Auth,
  secretsKey: Buffer,
  tenantId: string,
  connectionId: string,
): Promise<EngineCredential> {
  // Two queries on purpose. `findConnectionForTenant` never selects the secret — that is what keeps a stored
  // credential out of every listing — so reading one is a separate, deliberate act.
  const connection = await findConnectionForTenant(db, tenantId, connectionId);

  if (!connection) {
    // Scoped by tenant, so a connection belonging to another workspace is simply absent — the same answer a
    // connection that never existed gets.
    throw stepExecutionError("the connection no longer exists");
  }

  if (connection.kind === "token") {
    const sealed = await findConnectionSecret(db, tenantId, connectionId);

    if (!sealed) {
      throw stepExecutionError("the connection holds no secret");
    }

    return {
      kind: "token",
      connectorId: connection.providerId,
      token: decryptSecret(sealed, secretsKey),
    };
  }

  if (!connection.accountId || !connection.accountUserId) {
    // An OAuth connection whose account reference is gone cannot be refreshed, and reporting that is better than
    // handing a kit a token that will fail upstream for an unexplained reason.
    throw stepExecutionError("the connected account is no longer linked");
  }

  /**
   * Better-Auth's provider id, not ours.
   *
   * A connection row stores the *connector* id — `google` — because that is the identifier the
   * catalogue, the builder and the flow definition all use. Better-Auth holds the linked account under
   * the suffixed one, `google-connector`, so that authorising Google for automation cannot widen what
   * signing in with Google is allowed to do. Asking for a token under the bare id fails with
   * "Provider google is not supported", because the worker registers no sign-in providers at all — and
   * in a process that did, it would resolve the *sign-in* account, whose scopes cannot send an email.
   */
  const result = await auth.api.getAccessToken({
    body: {
      providerId: toConnectionProviderId(connection.providerId),
      accountId: connection.accountId,
      userId: connection.accountUserId,
    },
  });

  const accessToken = result?.accessToken;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw stepExecutionError("the provider did not return an access token — the connection may need re-authorising");
  }

  return { kind: "oauth", connectorId: connection.providerId, accessToken };
}
