# `bun run dev` now starts its own containers

- **Date:** 2026-08-16
- **Type:** feat
- **Scope:** `scripts/`, `packages/shared`, root `package.json`

## Summary

New `scripts/dev-up.ts`, wired in as `bun run dev:up` and run automatically by `bun run dev`. It
starts the Docker engine if it is not already running, waits for it, brings up Postgres and Redis,
waits for their healthchecks, checks the ports the apps are about to bind, and applies migrations.
A cold machine now needs one command.

## Why

`bun run dev` started the three apps and nothing else, so on a machine where Docker was not already
up they all launched fine and then failed at the first query. The failure is legible only if you
already know what it means:

```
connect ECONNREFUSED ::1:6379
connect ECONNREFUSED 127.0.0.1:6379
```

That is not a Redis problem, a credentials problem, or two separate problems — it is "the container
was never started", reported once per address family and once per dependency. Wrong password or
wrong database name would connect and *then* fail; refused on both stacks means nothing is bound to
the port at all.

Docker Desktop can also sit in a state where its UI processes and its WSL distro are running but the
engine pipe never appears, which looks identical from the application's side. The script polls for a
responsive engine rather than for the process, so it reports that case honestly instead of racing it.

The second failure has the same shape. `bun run dev` starts three apps in parallel, so a leftover
server from an earlier session kills one of them with a stack trace and no indication of which app
lost, or what is holding the port:

```
error: Failed to start server. Is port 3000 in use?
  code: "EADDRINUSE"
```

Checking the ports up front turns that into the process name and pid, before any app starts.

## What changed

- **`scripts/dev-up.ts`** — a new top-level `scripts/` directory, for tooling that orchestrates the
  repo rather than belonging to one workspace. Imports config by relative path, the same way
  `apps/web/vite.config.ts` does and for the same reason: workspace packages are linked into each
  app's `node_modules`, not the root's, so `@automend/shared` does not resolve from here.
- **`bun run dev`** is now `dev:up && bun run --filter '*' dev`. Added `dev:up` and `dev:down`.
- **`--all`** brings up the api, worker and web containers too, and skips the migration step because
  the compose `migrate` service has already run them and the apps waited on it.
- **`scripts/ports.ts`** finds and frees whatever holds a port. Split from `dev-up.ts` because it
  is the one part that terminates someone else's process, and that is worth reading on its own. It
  names the process before asking, defaults to *not* killing, declines when there is no terminal to
  answer at, and confirms the port is genuinely free by re-probing rather than by trusting that the
  kill call returned — a process takes a moment to unwind, and reporting success early just moves
  the `EADDRINUSE` a few seconds later. `--free-ports` skips the prompt.
- **`config.localDev.docker`** and **`config.localDev.hostPorts`** hold what the scripts would
  otherwise hardcode: which compose services count as dependencies (derived from the same
  service-name primitives the connection URLs use), the per-platform launcher, the engine timeout,
  and which host ports the dev loop binds along with the env var that moves each.
  `localDev.postgres.serviceName` and `localDev.redis.serviceName` are now exposed for that
  derivation.

Deliberately not done: starting the daemon on Linux. There `dockerd` is a system service, and
`sudo systemctl start docker` is not a command a project script should run on someone's machine. The
script prints it and exits non-zero.

## Action required

**None.** `bun run dev` keeps working and now does more. The old
`docker compose up -d postgres redis && bun run db:migrate` sequence still works if you prefer it.

## Verification

Run against the exact failure that prompted it — Docker Desktop down, nothing on 5432 or 6379:

```
▸ Docker engine
  not running — starting it
..  engine ready after 11s
▸ Starting postgres and redis
 Container automend-postgres-1  Healthy
 Container automend-redis-1  Healthy
▸ Applying migrations
```

- `bun run preflight` afterwards — 4/4 pass, including BullMQ's Lua scripts against Dragonfly.
- Re-ran `bun run dev:up` — reports `already running` and re-converges without restarting anything.

Port handling was run against three real conflicts (all of api, worker and web already running):

```
▸ Host ports
  port 3000 (api) is held by bun pid 36168
  port 3002 (worker health) is held by bun pid 30644
  port 5173 (web dev server) is held by node pid 22880

FAILED: the ports the apps need are in use
```

Non-interactive, so it declined and exited 1 rather than killing three of the developer's processes
on a guess. The terminate path was then exercised in isolation against a process spawned for the
purpose: the owner was found, SIGTERM sent, and the port confirmed free. Worth noting that the pid
found was the listening child rather than the pid `Bun.spawn` returned — which is the correct one to
signal, and the reason the lookup goes through the OS rather than tracking what it started.

`bun test` and `bunx biome check .` are clean. `bun run config:check` fails, but not because of this
change — see below.

## Known issue, pre-existing

`bun run config:check` reports `.env.example` stale, because commit `2a86054` hand-added
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to a file that is generated. Running `config:sync`
deletes them. The fix is to add both to the generator's section list and to `env.ts`; until then the
check cannot pass and should not be wired into CI.
