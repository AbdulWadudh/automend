import { type ConnectorId, config } from "@automend/shared";
import { authClient } from "./auth-client";

const { routes } = config.webClient;

/** The search parameter the provider comes back with, so the page knows which connection to record. */
export const CONNECTED_PARAM = "connected";

/**
 * Sends the browser to the provider to authorise the connection.
 *
 * The connector's provider id is suffixed (`slack-connector`) so it is a different registration from
 * the sign-in provider of the same name — connecting a service must not widen what signing in with it
 * is allowed to do.
 */
export async function startOAuthConnection(connectorId: ConnectorId) {
  await authClient.oauth2.link({
    providerId: `${connectorId}${config.connectors.connectionProviderSuffix}`,
    callbackURL: `${routes.connections}?${CONNECTED_PARAM}=${connectorId}`,
  });
}
