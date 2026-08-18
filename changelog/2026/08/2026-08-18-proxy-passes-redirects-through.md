# Signing in works again: the web proxy hands redirects to the browser

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `apps/web`, `packages/shared`

## Summary

The web server's proxy no longer follows redirects. It now uses `forwardRequest` from
`packages/shared/src/http-proxy.ts`, which returns the upstream's response — 3xx included — to the
browser that asked for it.

## Why

Google sign-in ended on the callback URL showing this, as JSON, in the address bar:

```json
{"error":{"code":"NOT_FOUND","message":"No route matches GET /app/flows"}}
```

Better-Auth answers an OAuth callback with `302 → /app/flows` and the session in `Set-Cookie`. The
proxy called `fetch` with `redirect: "follow"`, so the redirect was resolved *inside the web
container*, against the API's own address: `http://api:3000/app/flows`. The API serves no such page
— it is the SPA's route — so it answered with its 404 envelope, and that is what the browser
received. The `Set-Cookie` went with the response that carried it, so even a user who navigated to
`/app/flows` by hand arrived signed out.

A proxy has no business following a redirect. The `Location` is meaningful to the browser's
address bar, not to the process relaying the bytes.

Only production was affected: the Vite dev server's proxy does not follow redirects, so this was
invisible on a laptop and total in a deployment.

## What changed

- `packages/shared/src/http-proxy.ts` exports `forwardRequest(request, targetUrl)`, exported from
  the package as `@automend/shared/http-proxy`. It strips `Host` and the hop-by-hop headers exactly
  as the web server did, and passes `redirect: "manual"`.
- `apps/web/server.ts` uses it for both proxied prefixes and no longer defines its own helper. The
  API and OTLP paths behave identically; only the redirect handling changed.
- It lives in `packages/shared` rather than beside `server.ts` because the web image copies only
  `server.ts` and `packages/shared` — a second file next to the server would have to be added to
  the Dockerfile, and forgetting that is a runtime failure no build catches.

## Action required

**None.** No new variables, no migration.

## Verification

- `packages/shared/tests/http-proxy.test.ts` asserts the redirect reaches the caller with its
  `Location` and `Set-Cookie` intact, and that the session cookie survives header stripping. It was
  confirmed to fail with `redirect: "follow"` before being kept.
- The real `apps/web/server.ts`, run against an upstream that answers a callback with
  `302 → /app/flows`: the response arrives as `302` with the cookie, and `/app/flows` serves
  `index.html` with `200`.
