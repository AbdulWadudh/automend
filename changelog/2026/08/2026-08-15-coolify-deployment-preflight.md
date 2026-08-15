# Add a deployment preflight check and Coolify deployment notes

- **Date:** 2026-08-15
- **Type:** feat
- **Scope:** `apps/worker`, `deploy/coolify`

## Summary

`bun run preflight` verifies that a deployment's Postgres, Redis, BullMQ and OTLP collector
actually work, and `deploy/coolify/README.md` documents the environment every app needs. Both exist
because of one failure mode that nothing else catches.

## Why

Dragonfly refuses Lua scripts that access undeclared keys. BullMQ's scripts do exactly that, so on
a default Dragonfly **every health check passes while job processing is completely broken** — the
API is green, the worker is green, `/health` reports Redis "up" because `PING` works, and jobs fail
the moment one is enqueued.

This was not theoretical. Running the check against the deployed Coolify Dragonfly (df-v1.40.1)
returned:

```
ERR script tried accessing undeclared key, key: bull:{automend-preflight}:1
```

A `/health`-based smoke test would have shipped that to production. The preflight is the only thing
in the repo that exercises the actual Lua path.

## What changed

- **`apps/worker/scripts/preflight.ts`** — checks Postgres reachability, Redis reachability,
  a real BullMQ enqueue-and-obliterate cycle, and an OTLP log POST. Exits non-zero on any failure
  and prints the remedy for the Dragonfly case specifically. It lives in the worker because that is
  the app already depending on all three; `packages/shared` must not gain `bullmq`/`ioredis`
  dependencies, since the browser bundle imports it.
- **`deploy/coolify/README.md`** — per-app environment variable matrix, internal-vs-public URL
  guidance, migration and health-check setup, and the Dragonfly requirement. Placeholders only; no
  credentials belong in this repo.

## Action required

**On the Dragonfly resource in Coolify**, add these and restart:

```
DFLY_cluster_mode=emulated
DFLY_lock_on_hashtags=true
```

Dragonfly reads any flag from a `DFLY_`-prefixed variable, which is how to set them when the
container command is not editable. Automend's queue names are already brace-wrapped
(`{flow-executions}`) to supply the hashtag — both halves are required together.

Then re-run `bun run preflight` and confirm the `bullmq` check passes.

**Do not make Postgres or Dragonfly publicly available.** Coolify's toggle exposes them on the
host's public IP behind only a password. For the queue that means arbitrary job injection into the
execution engine; for Postgres it is a full data compromise. The apps reach both by internal
service name, so nothing needs the public endpoint.

## Verification

Run against the live Coolify Dragonfly and SigNoz collector, with a local Postgres:

```
[PASS] postgres  — reachable
[PASS] redis     — reachable (Dragonfly df-v1.40.1)
[FAIL] bullmq    — script tried accessing undeclared key
[PASS] telemetry — https://…/v1/logs → HTTP 200
```

The `bullmq` failure is the deployment defect the check was written to catch, not a defect in the
check. It should pass once the two flags are set.
