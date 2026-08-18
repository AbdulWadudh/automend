# Two operator consoles, reached from an Operations page

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `api`, `web`, `packages/shared`, `docker-compose.yml`, `deploy/coolify`

## Summary

Bull Board is mounted by the API at `/ops/queues` and Drizzle Gateway runs as a `studio` compose
service. Both are reached from a new **Operations** page at `/app/operations`, which asks for the
operator password and links onward. Both are **off** until a deployment sets a credential — an
unconfigured deployment answers the ordinary 404, and the studio refuses to deploy at all rather than
starting one that accepts any password.

## Why

Two questions had no answer without a terminal on the server, and there is no terminal on the server.

The first is "why has this run not executed". The outbox relay reports a row it has given up on, but
the failure mode that pattern hides is a run that exists, looks queued, and never executes — and that
is a state you diagnose by looking at the queue, not at a log line. The second is "what does the
database actually contain", which until now meant `drizzle-kit studio` on a laptop pointed at
production, or nothing.

Four decisions inside are load-bearing.

**Neither console is behind the session.** Both read *across* tenants — the queue holds every
workspace's job payloads, the studio holds every workspace's rows — so `requireSession` would scope
nothing. It would hand any signed-in user everybody else's data while looking like access control.
Each carries its own administrative credential instead, and absent credentials means the surface does
not exist rather than that it stands open.

**There is no HTTP Basic auth, and the Operations page is why.** The first working version used
`basicAuth`, which means the *browser's* own credential dialog: an operating-system box drawn over a
themed product, which no stylesheet can reach, which cannot say what is being asked for or what it
grants, and which offers nothing when you get it wrong. It is the same class of defect as the native
`<select>` this codebase already has a rule about. The password is asked for on a real page now and
exchanged for a signed cookie.

**The consoles live under `/ops`, not `/api/v1`.** Every versioned route answers with the `{ data }` /
`{ error }` envelope; the dashboard serves an EJS shell and a static bundle. The web server proxies
`/ops` onward the way it already proxies `/api`, so the console is reachable on the one public origin
and the API still needs no domain of its own. The JSON API *about* the consoles is a separate,
versioned `/api/v1/operations` — mixing an envelope-returning API into `/ops` would make the verbatim
proxy rule ambiguous.

**The `/ops` proxy forwards its prefix verbatim, unlike `/otlp`.** Bull Board writes its script and API
URLs relative to the path it was mounted at, via a `<base href>`. Stripping the prefix the way the OTLP
proxy does serves the page and then 404s every script the page asks for.

The studio could not be given the same treatment: Gateway serves its assets from the root of whatever
origin it is on, so it cannot live under a path prefix. It gets a domain of its own, and the API is told
that address through `STUDIO_URL` because it has no way to derive it.

## What changed

### The gate

- **`apps/api/src/http/ops-session.ts`** — new. `createOpsSession` checks the operator password in
  constant time and issues the grant the dashboard looks for. Three properties are the whole security
  of it, and each has a test:
  - the cookie is signed, `HttpOnly`, `SameSite=Lax`, `Path=/` (two prefixes read it), and `Secure`
    only where the browser reaches the deployment over HTTPS — derived from `AUTH_BASE_URL`, not
    `NODE_ENV`, because a `Secure` cookie on a plain-http laptop is silently never sent, which looks
    exactly like a rejected password;
  - it is signed with the deployment secret **and the password**, so rotating the password invalidates
    every grant already handed out;
  - its age is checked against the timestamp inside the signed value, not only against `Max-Age`, which
    is the client's to discard.
  - Both sides of the password comparison are SHA-256'd first: `timingSafeEqual` throws on a length
    mismatch, so comparing raw strings would crash on the common failure *and* leak the length.
- **`apps/api/src/routes/operations.ts`** — new. `GET /consoles` reports which consoles exist and
  whether this browser holds a grant; `POST /session` exchanges the password for one; `DELETE /session`
  gives it up. Behind `requireSession` — not because a session authorises a console, but so the password
  is only ever offered to somebody already signed in. An unconfigured deployment and a wrong password
  are answered identically.
- **`apps/api/src/http/error-handler.ts`** — Hono's `HTTPException` now passes through with its own
  response instead of being folded into the error envelope. A real bug, not a tidy-up: the envelope
  rebuild dropped response headers, which is what made `basicAuth`'s 401 arrive as a 500 while it was
  still in use, and it applies to any Hono middleware that signals a refusal.

### The consoles

- **`apps/api/src/routes/queue-dashboard.ts`** — new. Returns a Hono sub-app, or `undefined` when
  unconfigured, which is what `app.ts` checks before mounting. The guard covers the wildcard rather than
  the entry route, because the static bundle and the JSON endpoints behind it are each reachable
  directly. A browser navigating in without a grant gets a 303 to the Operations page; the dashboard's
  own fetches get the 401 envelope, since following a redirect would hand them an HTML page.
  - The BullMQ `Queue` reuses the API's existing ioredis client rather than opening a second
    connection. A `Queue` is a producer, so BullMQ asks it for a non-blocking connection and accepts a
    client whose `maxRetriesPerRequest` is set — a `Worker` would throw on the same client.
  - `uiBasePath` is passed explicitly. The library otherwise resolves its own assets with
    `eval("require.resolve(...)")`; resolving it here fails at start-up instead of as a blank page.
  - `trimTrailingSlash` is installed *after* the guard, because `/ops/queues/` would otherwise answer
    the JSON 404 — and the page's own `<base href>` carries the slash that invites the mistake.
- **`docker-compose.yml` and `deploy/coolify/docker-compose.yml`** — a `studio` service in both, named
  for what it is rather than what runs it, the same way `redis` is really Dragonfly. Not in `dev:up`'s
  dependency services; bring it up with `docker compose up studio`.

### The page

- **`apps/web/src/routes/app/operations.tsx`** — new. Two cards, and a console this deployment has not
  configured is listed as unconfigured with the variable to set rather than hidden — the same treatment
  the connections page gives an unconfigured connector. The password field has a visible label, helper
  text under it, an error with `role="alert"` beside the field it belongs to, a reveal toggle *inside*
  the field so it cannot displace the controls around it, and `autocomplete="current-password"` with
  paste left alone so a password manager can fill it.
- **`apps/web/src/components/app/app-header.tsx`** — an **Operations** nav item, rendered only when the
  API reports at least one console. It shares the page's query, so arriving there costs no second
  request.
- **`apps/web/server.ts` and `vite.config.ts`** — both now proxy the ops prefix to the API, with no path
  rewrite. The two API-bound proxy rules in `server.ts` share one `forwardToApi` helper.

### Configuration

- **`packages/shared/src/config.ts`** — a `config.ops` domain (the dashboard's title, password bound and
  cookie settings; the studio's service name, pinned image, port, store path and local password) plus
  the `opsPrefix`, `queueDashboard`, `operations` and `webClient.routes.operations` paths.
- **`packages/shared/src/operations.ts`** — new. The console-list and sign-in schemas. Copy stays in the
  component; this carries only what the browser cannot work out for itself.
- **`packages/shared/src/env.ts`** — `OPS_DASHBOARD_USER`, `OPS_DASHBOARD_PASSWORD` and `STUDIO_URL`.
  The password is optional but a *short* one is refused rather than accepted: unlike a half-configured
  OAuth provider, a weak value here does not fail closed. `STUDIO_URL` is deliberately **not** defaulted
  — a default would put a link to `localhost` in every user's sidebar on a deployment that forgot it.

### One trap worth naming

`STUDIO_PASSWORD` shipped blank in the first draft of this change, and that was wrong in a way worth
recording. Drizzle Gateway's login handler is `if (!MASTERPASS) return success`: with no master password
it still renders a password box and **accepts anything typed into it**. A blank value therefore ships a
console that looks guarded and is not — strictly worse than one with no login at all. `.env.example` now
ships a local throwaway value, both compose files use `${STUDIO_PASSWORD:?…}`, and
`tests/config.test.ts` fails if the local default is ever emptied.

## Action required

**New environment variables.** `bun run config:sync` has regenerated `.env.example`; copy the new lines
into your `.env`.

| Variable | Where | Effect |
|---|---|---|
| `OPS_DASHBOARD_USER` | api | With the password, mounts the dashboard at `/ops/queues` |
| `OPS_DASHBOARD_PASSWORD` | api | ≥16 characters or the API refuses to start |
| `STUDIO_URL` | api | The studio's address *as the browser sees it*, so Operations can link to it |
| `STUDIO_IMAGE`, `STUDIO_PORT` | compose | Defaults come from `config.ts` |
| `STUDIO_PASSWORD` | compose | The studio's `MASTERPASS`. **Must not be blank** — see above |

All are optional for the root compose file, and both consoles stay off without them. No migration, no
breaking API change.

`bun run db:studio` has been **removed from the root scripts**. It ran `drizzle-kit studio`, whose UI is
Drizzle's *hosted* front-end at `local.drizzle.studio` — a dependency on a third party being up, and it
was returning 401. It still exists as `bun run --cwd packages/db db:studio` for a database outside the
compose stack; the studio container is the supported path.

Changing `STUDIO_PASSWORD` needs `docker compose up -d --force-recreate studio`. A running container
keeps the value it started with, which reads as the new password being rejected.

**Read before exposing either console.** The dashboard is deliberately not read-only: whoever has the
password can enqueue a job the worker will run, which is a real execution of a real tenant's flow. The
studio is a full database console. On the open internet, layer Coolify's IP allowlist or its own Basic
Auth on both domains.

## Verification

`bun run verify` — all nine gates, including both compose files resolving, all three images building and
migrations replaying against a populated database. 510 unit tests pass, 39 of them new across
`apps/api/tests/http/ops-session.test.ts`, `apps/api/tests/routes/queue-dashboard.test.ts` and
`apps/api/tests/routes/operations.test.ts`.

Run against the real stack rather than only asserted in tests:

- **Off by default** — an API started with the variables unset logs no "queue dashboard mounted" line
  and answers `/ops/queues` with the ordinary `NOT_FOUND` envelope.
- **Half-configured** — with only the username set, the API warns which half is missing and stays off.
- **Short password** — `OPS_DASHBOARD_PASSWORD=short` stops the process at env validation, naming the
  variable and the bound, without echoing the value.
- **No browser dialog** — a browser navigating to `/ops/queues` without a grant gets
  `303 Location: /app/operations`; the dashboard's own fetch gets `401 UNAUTHENTICATED`.
- **The round trip, signed in as a real user** — wrong password → `401`; right password → `200` and a
  cookie; `/consoles` then reports `unlocked: true`; the shell, the CSS, all four JS bundles, the SVG,
  the favicon, `/api/queues` and `/api/redis/stats` all return `200`, and the queue listing reported the
  live `{flow-executions}` counts. `DELETE /session` → the next navigation is `303` again.
- **Through the web app's proxy** — the same round trip against `apps/web/server.ts` pointed at the API:
  the cookie survives both hops and the 303's relative `Location` resolves against the public origin. The
  SPA catch-all and the `/api` proxy still answer as before, so the new prefix shadows nothing.
- **Inside the built image** — `automend-verify-api` run on the compose network serves the shell and
  every asset, which is what confirms Bull Board's static path resolves against the container's working
  directory and not only against the repo's.
- **The studio** — `docker compose up studio` starts, serves its UI on `4983`, receives `PORT`,
  `STORE_PATH` and a non-empty `MASTERPASS`, writes `store.json` into the `studio-data` volume, and its
  login endpoint answers `400 Invalid password` to a wrong password and `200` to the configured one.
