# A Gmail step can actually use its Google connection

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `worker`

## Summary

Every OAuth step failed at credential resolution with `Provider google is not supported`. The worker
was asking Better-Auth for a token under the *connector* id (`google`) instead of the provider id
Better-Auth stores the account under (`google-connector`). One line in
`apps/worker/src/credentials.ts`, plus the run's failure reason now reaching the logs rather than only
the database.

## Why

There are two provider ids for the same service, and that is deliberate:

- **`google`** — the connector id. What `config.connectors.providers` declares, what a kit names in
  `kitOAuth({ connectorId: "google" })`, what the catalogue serves, what the builder shows, and what a
  `connections` row stores. It is the domain identifier.
- **`google-connector`** — what Better-Auth holds the *linked account* under. Suffixed so that
  authorising Google for automation cannot silently widen what signing in with Google is allowed to do.

`apps/api/src/routes/connections.ts` gets this right: it looks the account up and fetches its profile
with `toConnectionProviderId(...)`, while storing the bare id on the row. `credentials.ts` did not — it
passed `connection.providerId` straight to `getAccessToken`.

That failed for two independent reasons, and it is worth naming both:

1. The worker constructs Better-Auth with **no sign-in providers at all** — it exists for
   `getAccessToken` alone. So `google` is not a provider it knows, and the error is literal.
2. Even in a process that *did* register Google sign-in, the bare id resolves the wrong account. In this
   database the two rows differ exactly where it matters:

   | `account.provider_id` | access token | refresh token | scopes |
   |---|---|---|---|
   | `google` | yes | **no** | `userinfo.email`, `userinfo.profile`, `gmail.send`, `openid` |
   | `google-connector` | yes | **yes** | `gmail.send`, `userinfo.email`, `userinfo.profile`, `openid` |

   The sign-in account has no refresh token, so once its access token expired nothing could renew it.
   Resolving it would have produced an unexplained upstream 401 rather than an honest error — which is
   the worse failure of the two.

The second half of the change is observability. The credential failure was logged as
`"run failed: a credential could not be resolved"` with only `runId` and the step name. The *reason*
was persisted on the run for the UI and never logged, so the telemetry backend recorded that a run had
failed and nothing about why — which is the one question anybody searching for it has.

## What changed

- **`apps/worker/src/credentials.ts`** — `resolveOne` now calls
  `getAccessToken({ providerId: toConnectionProviderId(connection.providerId), … })`. The comment above
  it records why two ids exist, because the two are both strings and nothing else in the file would stop
  the translation being dropped again.
  - `connectorId` on the returned `EngineCredential` deliberately stays *unsuffixed*: that is what a kit
    declared, and the suffix is Better-Auth's business rather than the kit's.
- **`apps/worker/src/processor.ts`** — the credential-failure log line now carries `reason`, `stepId` and
  `flowId` alongside `runId` and the step name, so the message a user sees in the UI is also the message
  in SigNoz.
- **`apps/worker/tests/credentials.test.ts`** — new. Seven tests, the first of which is the regression:
  it asserts the *request* made of Better-Auth rather than the credential handed back, because asserting
  the reply would keep passing while the wrong account was being asked for. Confirmed to fail against
  the pre-fix line and pass after it.

## Action required

**None.** No environment variable, no migration, no API change. Existing Google connections work as they
are — the account, its refresh token and its scopes were always correct, and only the lookup was wrong.

If a connection was created *before* this fix it needs nothing done to it. A run that failed with
`Provider google is not supported` can simply be retried.

## Verification

- `bun run verify` — all nine gates.
- The regression test was run against the pre-fix line and fails there (`"providerId": "google"` where
  `"google-connector"` is expected), then passes with the fix. A regression test that cannot fail is not
  one.
- Resolved against the **real connection in the development database**, not only against doubles: a
  throwaway script drove `resolveRunCredentials` with the actual `connectionId` and `tenantId` and got
  back `{ kind: "oauth", connectorId: "google", tokenLength: 253 }`. Better-Auth refreshed the token in
  the process — the stored access token had already expired, which is exactly the path the sign-in
  account could never have taken.
