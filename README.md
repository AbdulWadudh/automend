<img src="automend.webp" alt="Automend" width="120" />

# Automend

A self-hosted, AI-centric workflow automation platform — build flows visually (trigger → steps →
branches/loops), execute them reliably, scale horizontally.

**Status: bootstrap skeleton.** The monorepo, services, database, queue and container builds are
wired together and verified end to end. Flow execution, auth and the visual canvas are not
implemented yet.

---

## Prerequisites

| Tool                                          | Version             | Notes                                    |
| --------------------------------------------- | ------------------- | ---------------------------------------- |
| [Bun](https://bun.sh)                         | 1.3+                | Runtime, package manager and test runner |
| [Docker](https://docs.docker.com/get-docker/) | 24+ with Compose v2 | Local Postgres, Redis and app containers |

No Node.js installation is required.

---

## Repo layout

```
apps/
  api/            Hono API — routes, health checks, queue producers
  worker/         BullMQ consumer — flow execution engine (placeholder processor for now)
  web/            React + Vite app — flow builder UI
packages/
  db/             Drizzle schema, migrations, connection helpers  (used by api + worker)
  shared/         Zod schemas, typed env config, logger, domain errors  (used by everything)
```

`packages/*` are internal workspace packages — never published, imported via `workspace:*`.
Bun runs TypeScript directly, so there is no build step for the server apps.

---

## Quick start

```bash
bun install
cp .env.example .env          # required — docker compose reads its variables
docker compose up -d --build
```

That starts Postgres, Redis, applies migrations, then boots the API, worker and web app.

| Service       | URL                          | Purpose                                                     |
| ------------- | ---------------------------- | ----------------------------------------------------------- |
| Web           | http://localhost:8080        | React app (serves the bundle, proxies `/api` to the API)    |
| API           | http://localhost:3000        | Hono API                                                    |
| Worker health | http://localhost:3002/health | Worker liveness/readiness only — it serves no other traffic |
| Postgres      | `localhost:5432`             | user/password/db all `automend`                             |
| Redis         | `localhost:6379`             | DragonflyDB behind a Redis-compatible interface             |

The web app serves four pages. Their paths live in `config.webClient.routes`, and everything that
links to one reads from there:

| Path       | Page                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| `/`        | Landing page                                                                     |
| `/status`  | Live dependency health — the browser reaching the API, the API reaching Postgres and Redis |
| `/privacy` | Privacy policy                                                                   |
| `/tos`     | Terms of service                                                                 |

> The legal pages are **drafts pending legal review**, and the governing-law clause in
> `config.company.legal` is still a placeholder. See the
> [changelog entry](changelog/2026/08/2026-08-15-marketing-landing-page.md).

Verify it came up:

```bash
curl http://localhost:3000/health        # real Postgres + Redis probe, 503 if either is down
curl http://localhost:3000/api/v1/flows  # {"data":[]}
curl http://localhost:8080/api/v1/health # same report, through the web app's proxy
```

Tear down with `docker compose down` (add `-v` to also drop the Postgres and Dragonfly volumes).

> `docker-compose.yml` is **local development only**. Production is deployed by Coolify from each
> app's own Dockerfile — see [Deployment](#deployment).

---

## Day-to-day development

Running the apps from Docker means rebuilding on every change. For an iterative loop, run only the
infrastructure in Docker and the apps on the host:

```bash
docker compose up -d postgres redis
bun run db:migrate      # reads DATABASE_URL from your shell / .env

bun run dev:api         # http://localhost:3000  (hot reload)
bun run dev:worker      # consumes flow-executions (hot reload)
bun run dev:web         # http://localhost:5173  (Vite HMR, proxies /api to :3000)
```

There is one `.env` for the whole monorepo, at the repo root. Bun only auto-loads `.env` from the
current working directory, and these scripts run with the cwd set to their own workspace — so each
one passes `--env-file=../../.env` explicitly, and the Vite config sets `envDir` to the repo root.
Nothing to export by hand.

### Root scripts

| Command                    | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `bun install`              | Install every workspace's dependencies                         |
| `bun run typecheck`        | `tsc --noEmit` across all workspaces                           |
| `bun test`                 | Unit tests (`bun test`)                                        |
| `bun run check`            | Biome lint + format check                                      |
| `bun run check:fix`        | Biome lint + format, writing fixes                             |
| `bun run config:sync`      | Regenerate `.env.example` from `config.ts`                     |
| `bun run config:check`     | Fail if `.env.example` is stale (use in CI)                    |
| `bun run telemetry:verify` | Send marked log records to the collector and report acceptance |
| `bun run build`            | Production build (only the web app has one)                    |
| `bun run db:generate`      | Generate a migration from schema changes                       |
| `bun run db:migrate`       | Apply pending migrations                                       |

---

## Configuration

Every configured value in Automend — ports, timeouts, limits, route paths, queue names, defaults —
lives in [`packages/shared/src/config.ts`](packages/shared/src/config.ts). Nothing is written down
twice:

- The file has a **primitives** block (the handful of ports, hosts and path segments a human
  chooses) and then derives everything else from it. `defaultOrigins` is computed from the web
  ports, not typed out as a URL string, so changing `WEB_DEV_PORT` updates the CORS list, the Vite
  dev server and `.env.example` together.
- **`.env.example` is generated** from it — `bun run config:sync`. Don't hand-edit it.
- **`docker-compose.yml` reads `.env`** through `${VAR}` substitution, so it restates no port,
  credential or URL of its own.
- `bun run config:check` fails when `.env.example` has drifted, and
  `packages/shared/tests/config.test.ts` asserts the derivation relationships hold.

So changing the web dev port is one edit in `config.ts`, then `bun run config:sync`.

### Environment variables

Per-deployment overrides are validated by [`packages/shared/src/env.ts`](packages/shared/src/env.ts)
**at process startup**. A missing or malformed variable crashes the process immediately with a
message listing every problem at once — it never surfaces later as a confusing runtime failure.
Defaults come from `config.ts`; `env.ts` never hardcodes one.

| Variable             | Used by                 | Required | Default                            | Notes                                                     |
| -------------------- | ----------------------- | -------- | ---------------------------------- | --------------------------------------------------------- |
| `NODE_ENV`           | all                     | no       | `development`                      | `development` \| `test` \| `production`                   |
| `LOG_LEVEL`          | all                     | no       | `info`                             | `fatal`…`trace`                                           |
| `DATABASE_URL`       | api, worker, migrations | **yes**  | —                                  | must start with `postgres://` or `postgresql://`          |
| `REDIS_URL`          | api, worker             | **yes**  | —                                  | must start with `redis://` or `rediss://`                 |
| `API_PORT`           | api                     | no       | `3000`                             |                                                           |
| `WEB_ORIGIN`         | api                     | no       | dev server + web container origins | Comma-separated list of CORS origins                      |
| `WORKER_HEALTH_PORT` | worker                  | no       | `3002`                             |                                                           |
| `WORKER_CONCURRENCY` | worker                  | no       | `5`                                | 1–100                                                     |
| `WEB_PORT`           | web container           | no       | `8080`                             |                                                           |
| `API_URL`            | web container           | **yes**  | —                                  | Proxy target; server-side only, never sent to the browser |

`.env` files are git-ignored and must never be committed. Secrets are never logged: the Pino
logger redacts connection strings, tokens, passwords and auth headers at every level.

### Why the web app has no `VITE_API_URL`

The browser only ever calls its own origin. In development the Vite dev server proxies `/api` to
the API; in production the web container's Bun server (`apps/web/server.ts`) does the same, reading
`API_URL` at container start. Nothing about the API address is compiled into the bundle, so one
image works in every environment.

---

## Database and migrations

Drizzle ORM against PostgreSQL. **Migrations are the only way the schema changes** — never edit the
database by hand.

```bash
# 1. Edit packages/db/src/schema.ts
# 2. Generate the SQL (does not connect to a database)
bun run db:generate
# 3. Review and commit the generated file in packages/db/migrations/
# 4. Apply it
bun run db:migrate
```

`db:migrate` runs `packages/db/src/migrate.ts`, a plain Bun script, so production images do not need
drizzle-kit installed — only the committed SQL files. In Docker, the `migrate` compose service runs
it automatically before the API and worker start.

To apply migrations against the compose stack explicitly:

```bash
docker compose run --rm migrate
```

Current schema: a single `flows` table (`id`, `tenant_id`, `name`, `created_at`, `updated_at`) with
an index on `tenant_id`. Every tenant-owned table carries `tenant_id` from the first migration —
retrofitting multi-tenancy later means rewriting every query and backfilling every row.

---

## Queue

BullMQ on Redis. The worker consumes the `{flow-executions}` queue.

The Redis server we actually deploy is **DragonflyDB**. That is an infrastructure detail: `ioredis`
is the client, `REDIS_URL` is the variable, `redis://` is the scheme, and no application code knows
the difference — swapping in stock Redis needs no code change. Two Dragonfly-specific details do
have to stay in place, and they only work together:

- Dragonfly runs with `--cluster_mode=emulated --lock_on_hashtags` (see `docker-compose.yml`).
  Without those flags, BullMQ's Lua scripts force Dragonfly to lock the entire store per script,
  erasing its throughput advantage over Redis.
- **Queue names are wrapped in curly braces** (`"{flow-executions}"`) so Dragonfly has a hashtag to
  lock on. Each queue needs a *distinct* hashtag, or every queue is assigned to the same thread.
  The braces are inert on stock Redis, so these names are correct on either server.

Job payloads are validated with the shared Zod schema before any business logic sees them. A payload
that fails validation is rejected as `UnrecoverableError` — it will never parse on a retry, so
burning the job's remaining attempts is pointless.

---

## Observability

Every service logs to **stdout as structured JSON** *and* exports the same records over OTLP to
[SigNoz](deploy/signoz/README.md). Both, always — stdout is what `docker compose logs` shows and
what survives a collector outage; the collector is what you search.

| Service    | `service.name` in SigNoz |
| ---------- | ------------------------ |
| API        | `api`                    |
| Worker     | `worker`                 |
| Web server | `web`                    |
| Browser    | `web-browser`            |

Browser telemetry captures uncaught errors and unhandled rejections. It posts to `/otlp` on the web
app's own origin, which the server proxies to the collector — so the collector address is never in
the bundle and it needs no CORS configuration. Console output is deliberately *not* mirrored: high
volume, and the most likely place for user data to leak into telemetry.

```bash
bun run telemetry:verify   # sends marked records through the real logger, fails if not accepted
```

Setup, Coolify deployment and the local SigNoz stack: [deploy/signoz/README.md](deploy/signoz/README.md).

## Testing and code quality

```bash
bun test          # unit tests
bun run typecheck # tsc --noEmit, all workspaces
bun run check     # Biome lint + format
```

Biome is the single lint/format tool — do not add ESLint or Prettier. TypeScript runs in strict mode
everywhere with `noUncheckedIndexedAccess`.

The highest-value test surface is business logic: flow validation, execution state transitions and
idempotency handling. Current coverage is on the environment-validation and job-payload boundaries.

---

## Deployment

Each app has its own `Dockerfile` and is deployed independently by Coolify.

- Multi-stage builds on `oven/bun:1.3-slim`; the API image installs 46 packages, not the whole
  workspace, because `bun install --filter` scopes the install to one app.
- All configuration comes from environment variables — nothing is baked into an image.
- `api`, `worker` and `web` each expose `/health`. The API and worker probe their real dependencies
  and answer `503` when Postgres or Redis is unreachable, so Coolify can restart on a genuine
  outage rather than a hardcoded `200`. Point Coolify's health check at `/health`.
- Logs are structured JSON on stdout (Pino). There is no file logging.
- No service assumes local disk persistence — containers are disposable.

Build a single image manually:

```bash
docker build -f apps/api/Dockerfile -t automend-api .
```

The build context is always the repo root, because the images need the workspace packages.

---

## Changelog

Every feature or notable change gets an entry under [changelog/](changelog/), organised by
year/month with one date-stamped file per change. Write it as part of the change, not afterwards —
start from [changelog/TEMPLATE.md](changelog/TEMPLATE.md). See
[changelog/README.md](changelog/README.md) for the conventions.

## Architecture rules

Non-negotiable engineering rules (sandboxing of user-authored step code, idempotency keys,
transactional outbox, tenant scoping, envelope-encrypted secrets, Zod validation at every boundary)
live in [CLAUDE.md](CLAUDE.md). Read it before adding a feature — several of those rules are far
cheaper to honour now than to retrofit.
