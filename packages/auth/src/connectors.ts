/**
 * The OAuth providers a workspace connects *services* through, as opposed to the ones people sign
 * in with.
 *
 * These are deliberately separate registrations. Signing in with Google asks to know who you are;
 * connecting Google asks to send mail as you. Sharing one provider id between the two would mean
 * the login button quietly carrying automation scopes, and revoking a connection would sign the
 * person out. So each connector is registered under its own suffixed id — `google-connector` —
 * and Better-Auth keeps a separate account row, with its own tokens and its own scopes.
 */

import { config } from "@automend/shared";
import { genericOAuth } from "better-auth/plugins";

const { connectors } = config;

export type ConnectorCredentials = {
  clientId: string;
  clientSecret: string;
};

/** Keyed by the catalogue id (`slack`), not by the provider id Better-Auth sees. */
export type ConnectorCredentialMap = Partial<Record<string, ConnectorCredentials>>;

/** `slack` → `slack-connector`, so a connector can never collide with a sign-in provider. */
export function toConnectionProviderId(connectorId: string): string {
  return `${connectorId}${connectors.connectionProviderSuffix}`;
}

export function toConnectorId(connectionProviderId: string): string {
  return connectionProviderId.endsWith(connectors.connectionProviderSuffix)
    ? connectionProviderId.slice(0, -connectors.connectionProviderSuffix.length)
    : connectionProviderId;
}

/**
 * Reshapes a provider's own profile into the `{ id, email, name }` the callback insists on.
 *
 * Only needed where a provider names those fields differently — Discord returns `username`, and
 * without this the connection fails at the redirect with `name_is_missing`. Google and Slack both
 * speak OpenID Connect and need no mapping.
 */
const profileMappers: Record<string, ((profile: Record<string, unknown>) => Record<string, unknown>) | undefined> = {
  discord: (profile) => ({
    ...profile,
    name: profile.global_name ?? profile.username,
  }),
};

type OAuthConnector = Extract<(typeof connectors.providers)[number], { kind: "oauth" }>;

function isOAuthConnector(provider: (typeof connectors.providers)[number]): provider is OAuthConnector {
  return provider.kind === "oauth";
}

/** Which connectors this deployment can actually offer — both halves of the pair must be set. */
export function listAvailableConnectors(credentials: ConnectorCredentialMap): string[] {
  return connectors.providers
    .filter((provider) => provider.kind === "token" || credentials[provider.id] !== undefined)
    .map((provider) => provider.id);
}

/**
 * Builds the plugin, or returns nothing when no connector is configured.
 *
 * Registering `genericOAuth` with an empty list would add its endpoints for providers that cannot
 * work, so a deployment with no connectors simply does not have them.
 */
export function createConnectorPlugin(credentials: ConnectorCredentialMap) {
  const configured = connectors.providers.filter(isOAuthConnector).flatMap((provider) => {
    const pair = credentials[provider.id];

    if (!pair) {
      return [];
    }

    return [
      {
        providerId: toConnectionProviderId(provider.id),
        clientId: pair.clientId,
        clientSecret: pair.clientSecret,
        authorizationUrl: provider.authorizationUrl,
        tokenUrl: provider.tokenUrl,
        userInfoUrl: provider.userInfoUrl,
        scopes: [...provider.scopes],
        // Both are absent for providers that do not document them, rather than guessed at: an
        // unrecognised authorization parameter is rejected by some providers outright.
        ...("prompt" in provider ? { prompt: provider.prompt } : {}),
        ...("accessType" in provider ? { accessType: provider.accessType } : {}),
        mapProfileToUser: profileMappers[provider.id],
      },
    ];
  });

  if (configured.length === 0) {
    return undefined;
  }

  return genericOAuth({ config: configured });
}
