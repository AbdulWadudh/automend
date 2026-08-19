# The dev server answers to its tunnel

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/web`

## Summary

The Vite dev server now derives `server.allowedHosts` from `AUTH_BASE_URL` and `WEB_ORIGIN`, so
reaching it through a tunnel works without naming the tunnel a third time.

## Why

Vite refuses any request whose `Host` it does not recognise:

```
Blocked request. This host ("tunnel-5173.example.quest") is not allowed.
```

That became load-bearing rather than cosmetic: Slack refuses bot scopes to a PKCE flow redirecting
to localhost, so connecting Slack locally *requires* a public https origin in front of the dev
server. Without this the tunnel serves an error page and the OAuth round trip never starts.

The hostname is not written into `vite.config.ts`, because it differs per machine and per tunnel
session — that makes it configuration, not a constant. It is not a new environment variable either:
using a tunnel already means setting `AUTH_BASE_URL` (the origin the browser uses, and the one OAuth
redirect URIs are built from) and `WEB_ORIGIN` (the origins the api trusts). A third variable
holding the same hostname is the repetition this codebase derives its way out of.

## What changed

- `deriveAllowedHosts` in `apps/web/src/lib/dev-hosts.ts`, applied in `vite.config.ts`. It takes
  hostnames from those two settings, tolerates a malformed entry rather than refusing to start, and
  returns an empty list when nothing is configured — which leaves Vite's own localhost defaults.
- It remains an allow*list*: a host nobody configured is still blocked, which is the point of the
  check.

## Action required

**None** for anyone working on localhost.

To develop against Slack, point a tunnel at the web dev server and set both `AUTH_BASE_URL` and
`WEB_ORIGIN` to its https origin, then register
`<AUTH_BASE_URL>/api/v1/auth/oauth2/callback/slack-connector` in the Slack app. Restart the api and
worker afterwards — they read the environment once at start-up.

## Verification

Against a running dev server, asserting both halves:

- `Host: tunnel-5173.k79.quest` (configured) — `200`, the app's own `<title>`;
- `Host: evil.example.com` (not configured) — `Blocked request`.

Unit tests in `apps/web/tests/lib/dev-hosts.test.ts` cover the tunnel case, the comma-separated
list, de-duplication, a malformed entry and the unconfigured default. `bun test` — 640 pass.
