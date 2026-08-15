# Centralise all configuration into a single derived source

- **Date:** 2026-08-15
- **Type:** refactor
- **Scope:** `packages/shared`, `packages/db`, `apps/api`, `apps/worker`, `apps/web`, `docker-compose.yml`

## Summary

Every configured value — ports, timeouts, limits, route paths, queue names, connection strings,
defaults — now lives in `packages/shared/src/config.ts` and is imported as `config.<domain>.<value>`.
The file derives composite values from a small primitives block, `.env.example` is generated from
it, and `docker-compose.yml` reads that file's variables instead of restating any of them.

## Why

Magic numbers scattered across route files, Dockerfiles and compose YAML mean a port change is an
archaeology exercise, and the one place you miss fails silently.

Centralising alone was not enough. The first attempt still wrote
`defaultOrigins: ["http://localhost:5173"]` next to `devServerPort: 5173` — the same port declared
twice, in the same file. Changing one would have left the CORS list pointing at an origin nobody
serves, and nothing would have caught it. The fix is structural: primitives are declared once, and
everything composed from them is *computed*.

## What changed

- **`config.ts` has two halves.** A primitives block (`API_PORT`, `WEB_DEV_PORT`, `LOCAL_HOST`,
  `API_PREFIX`, …) where each value appears exactly once, and the exported `config` object which
  derives the rest through helpers (`httpUrl`, `postgresUrl`, `redisUrl`). No URL is ever written
  as a string literal.
- **`env.ts` no longer hardcodes a default.** Every `.default(...)`, bound and allowed-value list
  reads from `config`. It decides *how* configuration is validated, never *what* the values are.
- **`.env.example` is generated** by `packages/shared/scripts/generate-env-example.ts`
  (`bun run config:sync`). `bun run config:check` fails when it is stale — wire this into CI.
- **`docker-compose.yml` restates nothing.** All values come from `.env` via `${VAR}` substitution,
  and in-network URLs are composed from the same parts. Postgres and Dragonfly are now started on
  the configured port (`postgres -p`, `--port=`), so host and container agree even if it changes.
- **`config.test.ts` asserts relationships, not literals** — that the origin list contains the web
  ports, that the versioned health route is the base path plus the health path, that local
  connection strings are composed from the same credentials. A test that reads its expected value
  from config would assert nothing.
- Tests moved from `src/*.test.ts` to a `tests/` folder per package, mirroring `src/`.

## Action required

**`.env` is now required for `docker compose up`** — it was previously optional. Run
`cp .env.example .env` before starting the stack; compose reads its variables directly.

After changing anything in `config.ts`, run `bun run config:sync` and commit the regenerated
`.env.example`.

## Verification

- `bun test` — 35 pass, including the new config derivation guards.
- `bun run typecheck` — 5/5 workspaces clean. `bunx biome check .` — 63 files clean.
- `bun run config:check` — reports `.env.example` up to date.
- **Single-source proof:** changing `WEB_DEV_PORT` from `5173` to `4200` in `config.ts` and running
  `config:sync` propagated to the CORS origin list, the Vite dev server port and
  `WEB_ORIGIN` in `.env.example` with no other edit. Reverted afterwards.
- `docker compose up -d --build` — postgres, redis, api, worker and web all healthy; all three
  `/health` endpoints return 200; the web→api proxy works; queue round-trip consumed a valid job
  and rejected a malformed one as unrecoverable.
