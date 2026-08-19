# Kits declare their rate limits

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/kit-framework`, `packages/kits`, `apps/worker`, `packages/shared`

## Summary

A kit can now declare what its service will accept — `limits: kitRateLimit({ requests: 2, perSeconds: 1 })`
— and the engine holds every request a kit makes to it. Gmail declares the first one. Adding a
service is still a directory, a registry line, and now a number its documentation already gives you.

## Why

This is the first of three steps toward scaling integrations, and it was chosen over the obvious
alternative — a queue per kit — for reasons worth recording, because the obvious one looks right.

**A quota belongs to an account, not to a service.** Gmail allows 250 units per user per second; a
workspace with three Google connections has three budgets. One `{gmail}` queue would throttle all
three as though they were one, and — worse in a platform where every table carries `tenant_id` — it
would be shared across tenants, so one workspace's bulk send would starve everybody else's mail. The
bucket is therefore keyed by **connection**, which is the thing the limit actually belongs to.

**A per-kit queue would also cost the kit model.** Every new service would need a queue name, a
hashtag, a `Worker` and deployment wiring, instead of a directory and one line.

## What changed

- **`kitRateLimit({ requests, perSeconds })`** on `createKit`, validated at import like every other
  kit declaration, so a malformed limit stops the process at start-up. Absent means unthrottled,
  which is honest for a service that publishes no quota.
- **`apps/worker/src/engine/rate-limiter.ts`** — a token bucket in Redis, refill and decision in one
  Lua script. In Redis and not in the worker because an in-process bucket is a limit that *lies*:
  three replicas would grant three times the quota, which is the situation the limit exists to
  prevent.
- **It runs in the parent, not the engine subprocess.** The subprocess is spawned per run, so a
  bucket there would only bound one run against itself — and it holds no Redis connection by design,
  for the same reason it holds no database client.
- **Two new protocol messages.** `ctx.http` asks the parent for a token before each call a kit makes;
  the parent waits on the bucket and answers. The child names the *step*, never the bucket — which
  one it draws from is decided in the parent, so a kit cannot spend another connection's quota. Same
  reasoning as it being handed one credential rather than the means to fetch any.
- **The Dragonfly hashtag wraps the bucket's identity, not the prefix.** The opposite of a queue
  name, and for the same reason: queues want one hashtag each so they do not serialise; limiters want
  one *per bucket* so they do not all land on a single thread.
- A step waits at most half its own timeout for a token — derived from `ENGINE_STEP_TIMEOUT_MS`, so
  the two cannot drift — and then fails saying so, rather than silently eating the time meant for
  the work.

## Action required

**None.** No new environment variables; the worker's existing Redis connection carries it. Kits with
no declared limit behave exactly as before.

## Verification

`apps/worker/tests/engine/rate-limiter.test.ts` against a real Redis — the same rule as the database
tests, because the guarantee is atomicity rather than anything in this repo: it asserts that a fresh
bucket grants its capacity, that an exhausted one refuses inside the step's budget, that it refills,
that two connections do not share a bucket, and — the one that matters — that four clients racing for
the last token produce exactly one winner.

Two things found by running it rather than reading it:

- Dragonfly does accept the script, which was worth checking rather than assuming.
- `expect(promise).rejects.toThrow()` never settles under `bun test` and hangs the whole file until
  its timeout. The refusal is asserted with a plain `try`/`catch` instead.
