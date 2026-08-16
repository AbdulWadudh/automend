/**
 * Connection requests and the query keys they are cached under.
 */

import {
  type Connection,
  type ConnectorCatalogueEntry,
  type CreateOAuthConnectionRequest,
  type CreateTokenConnectionRequest,
  connectionListSchema,
  connectionSchema,
  connectorCatalogueSchema,
  type RenameConnectionRequest,
  revealedConnectionSecretSchema,
  type UpdateConnectionTokenRequest,
} from "@automend/shared";
import { z } from "zod";
import { requestApi } from "./api";

const CONNECTIONS_PATH = "/connections";

export const connectionQueryKeys = {
  all: ["connections"] as const,
  list: () => [...connectionQueryKeys.all, "list"] as const,
  catalogue: () => [...connectionQueryKeys.all, "catalogue"] as const,
};

export async function listConnections(signal?: AbortSignal): Promise<Connection[]> {
  return await requestApi({ path: CONNECTIONS_PATH, schema: connectionListSchema, signal });
}

export async function fetchConnectorCatalogue(signal?: AbortSignal): Promise<ConnectorCatalogueEntry[]> {
  return await requestApi({ path: `${CONNECTIONS_PATH}/catalogue`, schema: connectorCatalogueSchema, signal });
}

export async function createTokenConnection(body: CreateTokenConnectionRequest): Promise<Connection> {
  return await requestApi({
    path: `${CONNECTIONS_PATH}/token`,
    schema: connectionSchema,
    method: "POST",
    body,
  });
}

export async function createOAuthConnection(body: CreateOAuthConnectionRequest): Promise<Connection> {
  return await requestApi({
    path: `${CONNECTIONS_PATH}/oauth`,
    schema: connectionSchema,
    method: "POST",
    body,
  });
}

export async function renameConnection(connectionId: string, body: RenameConnectionRequest): Promise<Connection> {
  return await requestApi({
    path: `${CONNECTIONS_PATH}/${connectionId}`,
    schema: connectionSchema,
    method: "PATCH",
    body,
  });
}

export async function updateConnectionToken(
  connectionId: string,
  body: UpdateConnectionTokenRequest,
): Promise<Connection> {
  return await requestApi({
    path: `${CONNECTIONS_PATH}/${connectionId}/token`,
    schema: connectionSchema,
    method: "PUT",
    body,
  });
}

/**
 * Asks for a stored token in the clear.
 *
 * A POST despite reading nothing but state, because a GET would put the request in browser history
 * and in every proxy log between here and the API.
 */
export async function revealConnectionToken(connectionId: string): Promise<string> {
  const revealed = await requestApi({
    path: `${CONNECTIONS_PATH}/${connectionId}/reveal`,
    schema: revealedConnectionSecretSchema,
    method: "POST",
  });

  return revealed.token;
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await requestApi({
    path: `${CONNECTIONS_PATH}/${connectionId}`,
    schema: z.object({ id: z.uuid() }),
    method: "DELETE",
  });
}
