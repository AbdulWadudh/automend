/**
 * `/api/v1/connections` — the services a workspace can act through.
 *
 * Two ways in. A **token** connection is created here directly: the secret arrives once and is
 * envelope-encrypted before anything else happens to it. An **OAuth** connection is recorded after
 * the provider has redirected the browser back — Better-Auth already holds the tokens by then, and
 * this only records which workspace may use them.
 *
 * Exactly one route returns a secret, `POST /:id/reveal`, and it documents why it is allowed to.
 * Every other response here carries only the hint — the last few characters.
 */

import { toConnectionProviderId } from "@automend/auth";
import type { ConnectionSummary } from "@automend/db";
import {
  countConnectionsForProvider,
  deleteConnectionForTenant,
  findConnectionSecret,
  insertConnection,
  listConnectionsForTenant,
  renameConnectionForTenant,
  updateConnectionSecretForTenant,
  upsertOAuthConnection,
} from "@automend/db";
import {
  type Connection,
  type ConnectorCatalogueEntry,
  config,
  createOAuthConnectionRequestSchema,
  createTokenConnectionRequestSchema,
  notFoundError,
  renameConnectionRequestSchema,
  requestValidationError,
  updateConnectionTokenRequestSchema,
} from "@automend/shared";
import { decryptSecret, encryptSecret, secretHint } from "@automend/shared/crypto";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody, parseUuidParam } from "../http/validation";

const CONNECTION_ID_PARAM = "connectionId";
const CONNECTION_ID_ROUTE = `/:${CONNECTION_ID_PARAM}`;

const providersById = new Map(config.connectors.providers.map((provider) => [provider.id, provider]));

function toConnectionResponse(row: ConnectionSummary): Connection {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId as Connection["providerId"],
    kind: row.kind as Connection["kind"],
    displayName: row.displayName,
    accountId: row.accountId,
    accountEmail: row.accountEmail,
    accountName: row.accountName,
    secretHint: row.secretHint,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * "Google", then "Google 2" for the next one.
 *
 * A workspace may connect the same service several times — a personal mailbox and a shared one —
 * and two rows both called "Google" are indistinguishable in a list. This is only a starting
 * point; the name is editable precisely because only the person connecting it knows what it is.
 */
async function buildDefaultName(
  deps: ApiDependencies,
  tenantId: string,
  providerId: string,
  label: string,
): Promise<string> {
  const existing = await countConnectionsForProvider(deps.db, tenantId, providerId);

  return existing === 0 ? label : `${label} ${existing + 1}`;
}

export function createConnectionRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(createRequireSession(deps));

  /**
   * The catalogue, with each entry marked usable or not. Listed rather than filtered, so an
   * operator can see which connectors exist and what configuring one would take.
   */
  routes.get("/catalogue", (c) => {
    const catalogue: ConnectorCatalogueEntry[] = config.connectors.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      summary: provider.summary,
      scopes: [...provider.scopes],
      available: deps.availableConnectors.includes(provider.id),
    }));

    return respondWithData(c, catalogue);
  });

  routes.get("/", async (c) => {
    const { tenantId } = getRequestContext(c);
    const rows = await listConnectionsForTenant(deps.db, tenantId);

    return respondWithData(c, rows.map(toConnectionResponse));
  });

  routes.post("/token", async (c) => {
    const { tenantId, userId } = getRequestContext(c);
    const body = await parseJsonBody(c, createTokenConnectionRequestSchema);
    const provider = providersById.get(body.providerId);

    if (provider?.kind !== "token") {
      throw requestValidationError(`${body.providerId} is connected with OAuth, not with a token`);
    }

    // Encrypted before it is anywhere near a query, so no code path can insert it in the clear.
    const row = await insertConnection(deps.db, {
      tenantId,
      providerId: body.providerId,
      kind: "token",
      displayName: body.displayName,
      encryptedSecret: encryptSecret(body.token, deps.secretsKey),
      secretHint: secretHint(body.token),
      createdBy: userId,
    });

    return respondWithData(c, toConnectionResponse(row), 201);
  });

  /**
   * Records an OAuth connection the browser has just completed.
   *
   * The account is looked up rather than trusted from the body: the caller says *which provider*
   * they linked, and the API finds the matching account for that user. A request naming a provider
   * the user never linked therefore creates nothing.
   */
  routes.post("/oauth", async (c) => {
    const { tenantId, userId } = getRequestContext(c);
    const body = await parseJsonBody(c, createOAuthConnectionRequestSchema);
    const provider = providersById.get(body.providerId);

    if (provider?.kind !== "oauth") {
      throw requestValidationError(`${body.providerId} is connected with a token, not with OAuth`);
    }

    const linked = await deps.findLinkedAccount(userId, toConnectionProviderId(body.providerId));

    if (!linked) {
      throw requestValidationError(`${provider.label} has not been authorised yet`);
    }

    const connectionProviderId = toConnectionProviderId(body.providerId);
    const profile = await deps.fetchAccountProfile(userId, connectionProviderId, linked.accountId);

    const row = await upsertOAuthConnection(deps.db, {
      tenantId,
      providerId: body.providerId,
      kind: "oauth",
      // Named after the account holder, falling back to the address and then to a counted label.
      // The address still identifies the connection underneath, so the name here is free to be
      // the readable half.
      displayName:
        body.displayName ??
        profile?.name ??
        profile?.email ??
        (await buildDefaultName(deps, tenantId, body.providerId, provider.label)),
      accountId: linked.accountId,
      accountUserId: userId,
      accountEmail: profile?.email ?? null,
      accountName: profile?.name ?? null,
      scopes: linked.scope ?? provider.scopes.join(" "),
      createdBy: userId,
    });

    return respondWithData(c, toConnectionResponse(row), 201);
  });

  routes.patch(CONNECTION_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const connectionId = parseUuidParam(c, CONNECTION_ID_PARAM);
    const body = await parseJsonBody(c, renameConnectionRequestSchema);

    const row = await renameConnectionForTenant(deps.db, tenantId, connectionId, body.displayName);

    if (!row) {
      throw notFoundError(`No connection with id ${connectionId}`);
    }

    return respondWithData(c, toConnectionResponse(row));
  });

  /**
   * Replaces the secret on a token connection — a rotated key, or one that expired.
   *
   * Nothing here reads the old value. The new one is encrypted before the update is built, and the
   * query itself refuses anything that is not a token connection, so an OAuth row cannot end up
   * holding a secret it does not really have.
   */
  routes.put(`${CONNECTION_ID_ROUTE}/token`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const connectionId = parseUuidParam(c, CONNECTION_ID_PARAM);
    const body = await parseJsonBody(c, updateConnectionTokenRequestSchema);

    const row = await updateConnectionSecretForTenant(
      deps.db,
      tenantId,
      connectionId,
      encryptSecret(body.token, deps.secretsKey),
      secretHint(body.token),
    );

    if (!row) {
      throw notFoundError(`No token connection with id ${connectionId}`);
    }

    return respondWithData(c, toConnectionResponse(row));
  });

  /**
   * Returns a stored token in the clear — the one endpoint in the system that does.
   *
   * It exists because a self-hosted deployment is the only copy of the value: someone who stored a
   * key and lost it has nowhere else to look. The cost is real, and shapes how this is written:
   *
   * - A POST, not a GET, so the value can never be produced by a link, a prefetch, or a URL
   *   sitting in browser history and proxy logs.
   * - `no-store`, so no cache holds it after the response is read.
   * - Recorded in the log — who, which connection — while the value itself never is.
   *
   * What it is not is a second authentication factor: any valid session for the workspace can call
   * it. Requiring a password again before revealing is the obvious next step, and is not built.
   */
  routes.post(`${CONNECTION_ID_ROUTE}/reveal`, async (c) => {
    const { tenantId, userId } = getRequestContext(c);
    const connectionId = parseUuidParam(c, CONNECTION_ID_PARAM);
    const envelope = await findConnectionSecret(deps.db, tenantId, connectionId);

    if (!envelope) {
      throw notFoundError(`No token connection with id ${connectionId}`);
    }

    deps.logger.info({ tenantId, userId, connectionId }, "connection secret revealed");
    c.header("cache-control", "no-store");

    return respondWithData(c, { token: decryptSecret(envelope, deps.secretsKey) });
  });

  /**
   * Removes the workspace's authorisation. The underlying Better-Auth account is deliberately left
   * alone: the same person may have connected the same service to another workspace, and revoking
   * their access there is not this request's business.
   */
  routes.delete(CONNECTION_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const connectionId = parseUuidParam(c, CONNECTION_ID_PARAM);
    const deleted = await deleteConnectionForTenant(deps.db, tenantId, connectionId);

    if (!deleted) {
      throw notFoundError(`No connection with id ${connectionId}`);
    }

    return respondWithData(c, { id: connectionId });
  });

  return routes;
}
