/**
 * Connector schemas shared by the API and the web client.
 *
 * A connection is a workspace's authorisation to act in a third-party service. Note what is
 * absent from every response shape here: the secret. A stored token leaves the database exactly
 * once, on the path that uses it, and never on the path that lists it.
 */

import { z } from "zod";
import { config } from "./config";

/** The catalogue's own ids, kept as a literal union so a typo cannot pass the type-checker. */
export type ConnectorId = (typeof config.connectors.providers)[number]["id"];

const providerIds = config.connectors.providers.map((provider) => provider.id) as [ConnectorId, ...ConnectorId[]];

export const connectionKinds = ["oauth", "token"] as const;
export type ConnectionKind = (typeof connectionKinds)[number];

export const connectionSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  providerId: z.enum(providerIds),
  kind: z.enum(connectionKinds),
  displayName: z.string(),
  /** The provider's own id for the connected account. Opaque — shown only as a last resort. */
  accountId: z.string().nullable(),
  /** Who the connected account belongs to, as the provider reports it. Null until it is known. */
  accountEmail: z.string().nullable(),
  accountName: z.string().nullable(),
  /** Last few characters of a stored token. Never the token. */
  secretHint: z.string().nullable(),
  scopes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Connection = z.infer<typeof connectionSchema>;

export const connectionListSchema = z.array(connectionSchema);

/**
 * What the dashboard needs to render before anything is connected: the catalogue, and whether
 * each entry is usable in *this* deployment. A provider whose credentials are unset is listed as
 * unavailable rather than hidden, so an operator can see what they could turn on.
 */
export const connectorCatalogueEntrySchema = z.object({
  id: z.enum(providerIds),
  label: z.string(),
  kind: z.enum(connectionKinds),
  summary: z.string(),
  scopes: z.array(z.string()),
  available: z.boolean(),
});

export type ConnectorCatalogueEntry = z.infer<typeof connectorCatalogueEntrySchema>;

export const connectorCatalogueSchema = z.array(connectorCatalogueEntrySchema);

const displayNameSchema = z
  .string()
  .trim()
  .min(config.validation.connectionName.minLength)
  .max(config.validation.connectionName.maxLength);

/**
 * Creating a token connection. `tenantId` is absent by design — it comes from the session, never
 * from the body.
 */
export const createTokenConnectionRequestSchema = z.object({
  providerId: z.enum(providerIds),
  displayName: displayNameSchema,
  token: z.string().min(config.validation.connectionToken.minLength).max(config.validation.connectionToken.maxLength),
});

export type CreateTokenConnectionRequest = z.infer<typeof createTokenConnectionRequestSchema>;

/**
 * Recording an OAuth connection once the provider has redirected back. The tokens are already
 * held by Better-Auth at this point; this only says which workspace may use them.
 */
export const createOAuthConnectionRequestSchema = z.object({
  providerId: z.enum(providerIds),
  displayName: displayNameSchema.optional(),
});

export type CreateOAuthConnectionRequest = z.infer<typeof createOAuthConnectionRequestSchema>;

export const renameConnectionRequestSchema = z.object({
  displayName: displayNameSchema,
});

export type RenameConnectionRequest = z.infer<typeof renameConnectionRequestSchema>;

/**
 * Replacing the secret on a token connection — a rotated key, a token that expired.
 *
 * A replacement rather than an edit: the old value is not sent back to be modified, because it is
 * never sent back at all.
 */
export const updateConnectionTokenRequestSchema = z.object({
  token: z.string().min(config.validation.connectionToken.minLength).max(config.validation.connectionToken.maxLength),
});

export type UpdateConnectionTokenRequest = z.infer<typeof updateConnectionTokenRequestSchema>;

/**
 * The one response in the system that carries a secret.
 *
 * It exists because a self-hosted deployment is the only copy: someone who stored a token and lost
 * it has nowhere else to look. That convenience is paid for in exposure — anyone holding a session
 * for the workspace can read every credential it owns — so it is a deliberate request rather than
 * part of any listing, and the endpoint that serves it says so.
 */
export const revealedConnectionSecretSchema = z.object({
  token: z.string(),
});

export type RevealedConnectionSecret = z.infer<typeof revealedConnectionSecretSchema>;
