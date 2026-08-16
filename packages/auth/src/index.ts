/**
 * Shared authentication.
 *
 * Imported by the API today and by the worker once flow steps act on a user's behalf against
 * third-party services — the tokens for that live in the same Better-Auth tables.
 */

export type { Auth, CreateAuthOptions, SocialProviderCredentials } from "./auth";
export { createAuth } from "./auth";
export type { ConnectorCredentialMap, ConnectorCredentials } from "./connectors";
export { listAvailableConnectors, toConnectionProviderId, toConnectorId } from "./connectors";
export { authSchemaOptions } from "./options";
export type { AuthenticatedRequestContext } from "./session";
export { resolveRequestContext } from "./session";
export { buildPersonalWorkspaceName, buildWorkspaceSlug } from "./workspace";
