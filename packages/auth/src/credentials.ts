/**
 * Turning a stored connection into something a kit can act with.
 *
 * Here rather than in either app because both need it and neither may import the other: the worker
 * resolves a run's credentials up front, and the api resolves one to load a dynamic dropdown's
 * options. Two copies of this would be two places for the tenant scoping to drift.
 *
 * The secrets key is used here and stays in the calling process for exactly that reason — the
 * subprocess that runs kit code receives the *result*, one access token, rather than the means to
 * produce more.
 */

import { type Database, findConnectionForTenant, findConnectionSecret } from "@automend/db";
import type { KitCredential } from "@automend/kit-framework";
import { stepExecutionError } from "@automend/shared";
import { decryptSecret } from "@automend/shared/crypto";
import type { Auth } from "./auth";
import { toConnectionProviderId } from "./connectors";

export async function resolveConnectionCredential(
  db: Database,
  auth: Auth,
  secretsKey: Buffer,
  tenantId: string,
  connectionId: string,
): Promise<KitCredential> {
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
   * "Provider google is not supported", because a process registering no sign-in providers has none —
   * and in one that did, it would resolve the *sign-in* account, whose scopes cannot send an email.
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
