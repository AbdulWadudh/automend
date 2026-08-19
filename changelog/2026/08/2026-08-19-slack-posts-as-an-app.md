# Slack posts as an app

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/shared`, `packages/auth`, `packages/kits`

## Summary

The `slack` connector now runs Slack's v2 install flow with PKCE and stores a bot token, and a new
`slack` kit posts messages with it (`slack.sendMessage` → `chat.postMessage`). Slack was previously
a connector a workspace could authorise but nothing could use.

## Why

The connector spoke Slack's OpenID Connect endpoints, which identify a person and grant nothing.
`chat:write` is not obtainable that way: it is a *bot* scope, issued by the v2 install flow, and
that flow is not one Better-Auth's generic OAuth client can drive unaided. Two things stop it —

- `oauth.v2.access` reports failure as `200 {"ok":false,"error":"…"}`, so the generic exchange reads
  a refusal as a success and stores a token-shaped object with no token in it;
- it returns **two** tokens, a bot token at the top level and a user token under `authed_user`, and
  neither the generic exchange nor the generic user-info fetch picks the right one.

So `getToken` and `getUserInfo` are both replaced for this connector, in `packages/auth/src/slack.ts`.

Which token gets stored is the load-bearing decision. It is the **bot** token: a flow that posts as
the app keeps working after whoever installed it leaves the workspace, which a user token would not.
The user token is read once during the callback, only because `oauth.v2.access` carries no email and
the callback refuses a connection without one, and is then dropped.

PKCE is required rather than defensive. Once an app is opted into PKCE in Slack's own settings,
Slack rejects an authorization request that carries no `code_challenge` — and the exchange must then
send `code_verifier` *instead of* `client_secret`, which is what Slack documents for such an app.

## What changed

- `config.connectors.providers` — the `slack` entry now names `oauth/v2/authorize` and
  `oauth.v2.access`, requests the bot scopes `chat:write` and `chat:write.public` and nothing
  broader, and carries two new per-provider fields: `pkce` and `userScopes`.
- Two new optional connector fields, applied the way `prompt` and `accessType` already are — only
  when a provider declares them. `userScopes` becomes Slack's `user_scope` authorization parameter,
  which has no place in the standard `scope`.
- `packages/auth/src/slack.ts` — the install exchange and the user-info read. `connectors.ts` gains
  a `nonStandardFlows` map, so a provider that does not speak plain OAuth 2.0 has one place to say so
  rather than growing branches in the plugin builder.
- `packages/kits/src/slack/` — the kit, `sendMessage`, and `assertSlackOk`, which exists because
  Slack's HTTP 200 is not an answer about whether anything was posted.
- `packages/auth` now depends on `zod`, to validate Slack's responses at the boundary like any other
  network input.

## Action required

**Three things, and the first is a constraint rather than a setting.**

1. **`AUTH_BASE_URL` must be a public `https` origin — localhost will not work.** Slack classifies a
   localhost redirect as a *desktop* redirect once PKCE is enabled, and refuses bot scopes to one:

   > Something went wrong when authorizing this app. **Bot scopes are not allowed when redirecting
   > to a non-web URI.**

   So local development against Slack needs a tunnel to the web dev server, with `AUTH_BASE_URL` and
   `WEB_ORIGIN` both pointing at it. The dev server derives its allowed hosts from those two, so
   nothing else needs configuring — see the entry on the dev server and tunnelled hosts.

   This is the cost of PKCE here, and it is worth naming plainly: this platform's api is a
   *confidential* client that already holds its client secret safely, so PKCE buys it little. An app
   opted **out** of PKCE can use a localhost redirect with bot scopes and no tunnel at all. PKCE was
   chosen deliberately; the tunnel is what it costs.

2. Add the redirect URL `<AUTH_BASE_URL>/api/v1/auth/oauth2/callback/slack-connector` under **OAuth
   & Permissions → Redirect URLs** — the same `/oauth2/callback/:providerId` route Google and Discord
   already use, with the connector suffix.
3. Opt in to **Proof Key for Code Exchange (PKCE)** on the same page. The exchange sends no
   `client_secret`, so an app that is *not* opted in will reject it.

**Existing Slack connections must be re-authorised.** They hold an OpenID user token, which cannot
post; nothing migrates them, and a run reaching a Slack step with an old connection fails at Slack.
Reconnect from `/app/connections`.

No new environment variables — `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are the same pair as
before. No migration.

## Verification

`bun run verify` — all nine gates. New tests:

- `packages/auth/tests/slack.test.ts` — asserts the exchange sends `code_verifier` and **no**
  `client_secret`, stores the bot rather than the user token, leaves the expiry unset when rotation
  is off, treats `200 {"ok":false}` as a failure, and asks `openid.connect.userInfo` with the user
  token.
- `packages/kits/tests/slack/send-message.test.ts` — asserts what the kit asks Slack for, that
  `thread_ts` is sent only when the step names a message to reply to, and that an `ok:false` body
  fails the step rather than passing it.
