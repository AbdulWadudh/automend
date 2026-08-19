/**
 * Slack's v2 install flow, which is not an OAuth 2.0 flow Better-Auth can drive unaided.
 *
 * Two things make it special, and both are why this file exists rather than another entry in the
 * connector list. `oauth.v2.access` answers `200 {"ok":false}` for a failure and returns *two*
 * tokens — a bot token at the top level and a user token under `authed_user` — so neither the
 * generic token exchange nor the generic user-info fetch reads the right field. And PKCE means the
 * exchange carries a `code_verifier` instead of the client secret.
 */

import { config } from "@automend/shared";
import type { OAuth2Tokens, OAuth2UserInfo } from "better-auth/oauth2";
import { z } from "zod";

const slackConnector = config.connectors.providers.find((provider) => provider.id === "slack");

if (slackConnector?.kind !== "oauth") {
  throw new Error("The Slack connector is missing from config.connectors.providers");
}

const { tokenUrl, userInfoUrl } = slackConnector;

/**
 * The install response, narrowed to the fields a connection is built from.
 *
 * `expires_in` and `refresh_token` are present only when the app is opted into token rotation, so
 * they are optional here rather than a sign that something went wrong. `authed_user.access_token`
 * is absent when the person granted the bot scopes but not the user ones.
 */
const installResponseSchema = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  authed_user: z
    .object({
      id: z.string(),
      access_token: z.string().optional(),
    })
    .optional(),
});

const failedResponseSchema = z.object({ error: z.string() });

/** Slack's OpenID claims, which name the workspace as well as the person. */
const userInfoSchema = z.object({
  sub: z.string().optional(),
  "https://slack.com/user_id": z.string().optional(),
  "https://slack.com/team_id": z.string().optional(),
  "https://slack.com/team_name": z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  picture: z.string().optional(),
});

async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });

  return await response.json();
}

/**
 * `ok: false` arrives with HTTP 200, so a status check would treat every refusal as a success and
 * hand the callback a token-shaped object with no token in it.
 */
function readInstallResponse(payload: unknown) {
  const installed = installResponseSchema.safeParse(payload);

  if (installed.success) {
    return installed.data;
  }

  const refused = failedResponseSchema.safeParse(payload);

  throw new Error(
    refused.success
      ? `Slack refused the install (${refused.data.error})`
      : "Slack's install response was not the shape this connector expects",
  );
}

/**
 * Exchanges the code without the client secret, which is what PKCE asks of a client and what Slack
 * documents for an app opted into it. The proof is the `code_verifier`, which only the process that
 * started this authorisation holds.
 */
export function exchangeSlackInstallCode(clientId: string) {
  return async (data: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
  }): Promise<OAuth2Tokens> => {
    const installed = readInstallResponse(
      await postForm(tokenUrl, {
        client_id: clientId,
        code: data.code,
        redirect_uri: data.redirectURI,
        ...(data.codeVerifier ? { code_verifier: data.codeVerifier } : {}),
      }),
    );

    return {
      // The bot token, deliberately: it is the credential every kit step is handed, and it outlives
      // the person who installed the app.
      accessToken: installed.access_token,
      refreshToken: installed.refresh_token,
      // Left undefined when rotation is off, because a non-rotating bot token does not expire and
      // giving it an invented expiry would send Better-Auth refreshing something it cannot refresh.
      accessTokenExpiresAt:
        installed.expires_in === undefined ? undefined : new Date(Date.now() + installed.expires_in * 1_000),
      scopes: installed.scope?.split(",").filter((scope) => scope.length > 0),
      raw: installed as unknown as Record<string, unknown>,
    };
  };
}

/**
 * Identifies the account with the *user* token from the same install, not the bot token.
 *
 * `openid.connect.userInfo` answers only for a user token; asked with a bot token it returns
 * `not_authed`, and the connection would fail at the redirect with `user_info_is_missing`. The user
 * token is read here and then dropped — only the bot token is stored.
 */
export async function readSlackUserInfo(tokens: OAuth2Tokens): Promise<OAuth2UserInfo | null> {
  const userToken = installedUserToken(tokens);

  if (!userToken) {
    return null;
  }

  const response = await fetch(userInfoUrl, { headers: { authorization: `Bearer ${userToken}` } });
  const profile = userInfoSchema.safeParse(await response.json());

  if (!profile.success) {
    return null;
  }

  const { sub, name, email, email_verified, picture } = profile.data;
  const userId = profile.data["https://slack.com/user_id"] ?? sub;
  const teamName = profile.data["https://slack.com/team_name"];

  if (!userId || !email) {
    return null;
  }

  return {
    id: userId,
    // Named for the workspace, because that is what a connection *is* here — the app is installed
    // into a Slack workspace, and a list of connections showing three people's names says less than
    // one showing three workspaces.
    name: teamName ?? name ?? userId,
    email,
    image: picture,
    emailVerified: email_verified ?? false,
  };
}

function installedUserToken(tokens: OAuth2Tokens): string | undefined {
  const authedUser = tokens.raw?.authed_user;

  if (typeof authedUser !== "object" || authedUser === null) {
    return undefined;
  }

  const token = (authedUser as { access_token?: unknown }).access_token;

  return typeof token === "string" && token.length > 0 ? token : undefined;
}
