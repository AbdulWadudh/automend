# Deploying Automend on Coolify

Each app is its own Coolify resource, built from its own Dockerfile with the **repo root** as the
build context. Nothing is baked into an image — every value below is set in Coolify's environment
variable UI.

> **Never put these values in a file in this repo.** `.env` is git-ignored and `.env.example` is
> generated from `config.ts`, so neither is a place for real credentials.

## Resources

| Resource | Type | Notes |
|---|---|---|
| `postgres` | Database → PostgreSQL | Do **not** make it publicly available |
| `redis` | Database → Dragonfly | Do **not** make it publicly available — see below |
| `signoz` | Docker Compose | See [../signoz/README.md](../signoz/README.md) |
| `api` | Application | Dockerfile `apps/api/Dockerfile`, port `3000` |
| `worker` | Application | Dockerfile `apps/worker/Dockerfile`, port `3002` |
| `web` | Application | Dockerfile `apps/web/Dockerfile`, port `8080` |

Put the apps and the databases in the **same Coolify project** so they share a network and can use
internal hostnames.

## Required: Dragonfly needs hashtag locking

BullMQ's Lua scripts access keys they do not declare. Stock Redis allows this; **Dragonfly refuses
it by default**, so job processing fails while every health check still reports green.

Add these two environment variables to the Dragonfly resource and restart it:

```
DFLY_cluster_mode=emulated
DFLY_lock_on_hashtags=true
```

(Dragonfly reads any flag from a `DFLY_`-prefixed variable, which is how to set them when the
container command is not editable.)

Automend's queue names are already brace-wrapped (`{flow-executions}`) to give Dragonfly a hashtag
to lock on — that half is done. Both halves are required together.

Verify with `bun run preflight` (below). It is the only check that catches this.

## Environment variables

Take `DATABASE_URL` and `REDIS_URL` from the **internal** URL field on each database resource — the
eye icon reveals it. The public URL routes over the internet and, for Postgres, is disabled anyway.

### `api`

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | Postgres → *Postgres URL (internal)* |
| `REDIS_URL` | Dragonfly → *Dragonfly URL (internal)* |
| `API_PORT` | `3000` |
| `WEB_ORIGIN` | `https://<web-domain>` |
| `OTEL_LOGS_ENABLED` | `true` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL — no `/v1/logs`, no port |
| `OTEL_EXPORTER_OTLP_HEADERS` | empty |

### `worker`

Same as `api`, minus `API_PORT` and `WEB_ORIGIN`, plus:

| Variable | Value |
|---|---|
| `WORKER_HEALTH_PORT` | `3002` |
| `WORKER_CONCURRENCY` | `5` |

### `web`

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `WEB_PORT` | `8080` |
| `API_URL` | `http://<api-service-name>:3000` — internal, never the public domain |
| `OTEL_LOGS_ENABLED` | `true` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Same collector base URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | empty |

The web container proxies `/api` and `/otlp` to those targets from inside the network, which is why
neither the API nor the collector needs a public domain, and why no address reaches the browser.

## Migrations

Migrations are not run by the apps. Run them once per deploy, from the api image:

```bash
bun run /app/packages/db/src/migrate.ts
```

In Coolify, add it as a **pre-deployment command** on the `api` resource, or run it from that
resource's Terminal. It only needs `DATABASE_URL`.

## Health checks

Point Coolify's health check at `/health` on `api` (3000), `worker` (3002) and `web` (8080). The
api and worker probe Postgres and Redis for real and answer `503` when either is unreachable, so a
genuine dependency outage triggers a restart rather than being papered over.

## Verifying a deployment

From the `api` or `worker` resource's Terminal, with the deployment's environment loaded:

```bash
bun run preflight
```

Checks Postgres, Redis, **BullMQ's Lua scripts** and the OTLP collector, and exits non-zero on any
failure. Run it after changing any of the above — particularly after the Dragonfly flags.

## Do not expose the datastores publicly

Coolify's "Make it publicly available" toggle puts the database on the host's public IP with only a
password in front of it. Redis-protocol and Postgres ports are continuously scanned; a leaked or
brute-forced password is a full data compromise, and for the queue it also means arbitrary job
injection into the execution engine.

Keep both on the internal network. The apps reach them by service name, so nothing needs the public
endpoint. The same applies to the SigNoz collector — see [../signoz/README.md](../signoz/README.md).
