# The public web address is set explicitly, not read from a Coolify magic variable

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `deploy/coolify`, `scripts/verify.ts`, `packages/shared/tests`

## Summary

The Coolify stack no longer reads `${SERVICE_FQDN_WEB_8080}` to find its own public address. The
API's `WEB_ORIGIN` and `AUTH_BASE_URL` now come from a new required variable, `PUBLIC_WEB_URL`,
which the operator sets to the same domain assigned to the `web` service.

## Why

The deploy failed with `dependency failed to start: container api-… is unhealthy`, several minutes
after everything else came up green.

`SERVICE_FQDN_<SERVICE>_<PORT>` is not an environment variable Coolify hands to your containers. Its
compose parser *consumes* the key: it generates a domain, registers the proxy route, and moves on —
the value it computes is stored against the resource, never written to the `.env` the deploy
substitutes from. So `WEB_ORIGIN: ${SERVICE_FQDN_WEB_8080}` resolved to an empty string (compose
said as much, in a warning above the container list that is easy to read past).

An empty string is not an absent one, so Zod's `.default()` did not apply: `AUTH_BASE_URL` failed
`min(1)`, `loadApiEnv` threw at module scope, and the API exited before it could listen. Docker
restarted it, the health check never got an answer, and the only symptom that reached the deploy log
was the web service's `depends_on` giving up. The container that *reported* the failure was three
steps removed from the one that caused it.

Two smaller traps in the same mechanism, both avoided by not depending on it:

- The value of a `SERVICE_FQDN_*` key is a **path**, appended to the generated domain. The old
  `SERVICE_FQDN_WEB_8080: ${SERVICE_FQDN_WEB_8080}` therefore asked Coolify for a domain with a
  literal `${SERVICE_FQDN_WEB_8080}` on the end of it.
- Referencing the name *with* its port suffix from another service appends `:8080` to the hostname —
  so even where such a reference resolves, it produces an address the browser cannot use.

## What changed

- `PUBLIC_WEB_URL` is required by `deploy/coolify/docker-compose.yml` via `${PUBLIC_WEB_URL:?…}`,
  the same way `SECRETS_KEY` and `OTEL_EXPORTER_OTLP_ENDPOINT` already were. A missing value now
  stops `docker compose up` with a message naming the variable, instead of starting a stack that
  crash-loops.
- `SERVICE_FQDN_WEB_8080: /` stays on the `web` service, but only as what it is: the declaration
  that gives this stack its one public route.
- `scripts/verify.ts` supplies `PUBLIC_WEB_URL` rather than `SERVICE_FQDN_WEB_8080`. Supplying the
  magic variable is exactly what hid this from the verify gate — locally it looked like an ordinary
  variable, which is the one thing it is not.
- `packages/shared/tests/compose.test.ts` fails if the Coolify compose file reads any
  `SERVICE_FQDN_*` as a value, or if the `web` declaration stops being a path.
- The deploy README now assigns the domain before setting variables, since one is copied from the
  other, and gains a note on reading an "unhealthy" deploy failure.

## Action required

**Set `PUBLIC_WEB_URL` in the Coolify UI before redeploying** — to the domain assigned to the `web`
service, scheme included (`https://automend.example.com`). Without it the deploy stops immediately
with a message saying so.

Also check the `web` service's domain in the UI: a stack deployed from the previous file may have
had `${SERVICE_FQDN_WEB_8080}` appended to the domain Coolify generated for it.

No migration, no code change, no new application env var — `PUBLIC_WEB_URL` exists only in the
compose file, which maps it onto the `WEB_ORIGIN` and `AUTH_BASE_URL` the API already validated.

## Verification

- `loadApiEnv` with `AUTH_BASE_URL: ""` reproduces the deploy failure locally: it throws
  `AUTH_BASE_URL: Too small: expected string to have >=1 characters`.
- `docker compose -f deploy/coolify/docker-compose.yml config` resolves with no unset-variable
  warnings and yields `WEB_ORIGIN`/`AUTH_BASE_URL` = the supplied `PUBLIC_WEB_URL`.
- With `PUBLIC_WEB_URL` unset the same command stops with `required variable PUBLIC_WEB_URL is
  missing a value`, which is the behaviour the fix is for.
- The two new tests in `packages/shared/tests/compose.test.ts` were confirmed to fail against the
  previous compose file before being kept.
