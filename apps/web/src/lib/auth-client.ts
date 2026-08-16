/**
 * The browser's half of Better-Auth.
 *
 * No `baseURL` is given on purpose: the client then calls this app's own origin, which is exactly
 * what the platform wants. The web server proxies `/api` onward, so the API address is never
 * compiled into the bundle and the session cookie belongs to the origin the user is looking at.
 */

import { config } from "@automend/shared";
import { genericOAuthClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: config.auth.basePath,
  // The generic OAuth client is what connects a *service* (`authClient.oauth2.link`), as opposed
  // to signing in. Its endpoints exist on the server only for providers a deployment configured,
  // so the connections dashboard checks the catalogue before offering one.
  plugins: [organizationClient(), genericOAuthClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};
