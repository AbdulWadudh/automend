# Bootstrap the monorepo skeleton

- **Date:** 2026-08-15
- **Type:** feat
- **Scope:** repo-wide — `apps/api`, `apps/worker`, `apps/web`, `packages/db`, `packages/shared`

## Summary

Initial Bun workspaces monorepo with the API, worker and web app wired together end to end: the web
app reaches the API, the API reaches Postgres and Redis, and the worker consumes jobs from the
`{flow-executions}` queue. No flow execution logic, auth or visual canvas yet — this is the
skeleton only.

## Why

Getting the boundaries right on day one is much cheaper than retrofitting them. Three of the
platform's non-negotiable rules are structural and were treated as part of this step rather than as
later additions:

- **Tenant scoping.** `flows` carries `tenant_id` in the very first migration, with an index on it.
  The placeholder `GET /api/v1/flows` returns an empty array and deliberately does *not* query the
  table — an unscoped `select * from flows` is exactly the shortcut that becomes expensive to undo,
  so the codebase contains no such query to copy from.
- **Boundary validation.** Job payloads and environment variables are parsed with Zod before any
  business logic sees them.
- **Idempotency.** `flowExecutionJobSchema` already requires `idempotencyKey`, so the execution
  engine cannot be built without one.

## What changed

- **`packages/shared`** is the single typed config module. `loadApiEnv()`/`loadWorkerEnv()`/
  `loadWebServerEnv()` parse `process.env` at module scope, so a misconfigured deployment crashes at
  startup listing every problem at once, never mid-request. Error messages never echo values, which
  may be secrets. Server-only modules sit behind subpaths (`/env`, `/logger`) so they cannot reach
  the browser bundle.
- **Domain errors are factory functions, not classes** — `flowValidationError(msg)` returns a
  branded `Error`, discriminated with `isAutomendError()` rather than `instanceof`. See the
  functions-over-classes rule in CLAUDE.md.
- **`/health` performs real probes.** Postgres and Redis are checked in parallel, each bounded by a
  timeout, and the endpoint answers 503 when either is down. Failure detail goes to the logs only —
  the endpoint is unauthenticated and must not describe internals.
- **The web app has no API address in its bundle.** The browser always calls relative `/api`; Vite
  proxies it in development and `apps/web/server.ts` proxies it in production using `API_URL` read
  at container start. One image therefore works in every environment.
- **Queue names are brace-wrapped** (`"{flow-executions}"`). We deploy DragonflyDB as our Redis
  server, and it needs a hashtag to lock on or BullMQ's Lua scripts lock the entire store. Naming
  throughout the codebase stays `redis`/`REDIS_URL` — Redis is the interface, Dragonfly is the
  implementation. Both halves are documented in CLAUDE.md's Redis notes.
- **Migrations are applied by `packages/db/src/migrate.ts`**, a plain Bun script, so production
  images need only the committed SQL and not drizzle-kit. Drizzle Kit is used solely to generate.
- Multi-stage Dockerfiles on `oven/bun:1.3-slim` for all three apps; `bun install --filter` scopes
  each image to one app (the API installs 46 packages rather than the whole workspace).
- Biome configured at the root as the only lint/format tool, with the Tailwind CSS directive parser
  enabled and `routeTree.gen.ts` plus generated migrations excluded.

## Action required

**First-time setup.** Copy `.env.example` to `.env`. Required variables: `DATABASE_URL` and
`REDIS_URL`; the API also needs `API_URL` set in the web container. Then:

```bash
bun install
docker compose up -d --build
```

The `migrate` compose service applies migrations automatically before the API and worker start.
Running the apps outside Docker requires `bun run db:migrate` once.

## Verification

- `bun run typecheck` — 5/5 workspaces clean.
- `bun test` — 22 pass, covering env fail-fast/defaults/secret-redaction, job payload validation
  (rejects missing tenant and missing idempotency key), and the error factories and type guards.
- `bunx biome check .` — 60 files clean.
- `docker compose up -d --build` — postgres, redis, api, worker and web all report healthy; the
  `migrate` service exits 0 and `flows` plus `flows_tenant_id_idx` exist in Postgres.
- `GET /health` on api (:3000), worker (:3002) and web (:8080) all return 200 with real dependency
  latencies; `GET /api/v1/health` returns the same report through the web container's proxy and
  through the Vite dev server.
- Queue round-trip: a valid job was consumed and logged with its full context; a malformed payload
  was rejected as `UnrecoverableError`, logged, marked failed, and the worker stayed up.
