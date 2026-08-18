# The images could not build, and the compose file could not parse

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/api`, `apps/worker`, `apps/web`, `deploy/coolify`, `CLAUDE.md`

## Summary

Two new workspace packages landed and no `Dockerfile` copied them, so all three images failed to build — which
means the last five changes were not deployable. Also a `${VAR:?message}` with a colon in it, which is not valid
unquoted YAML.

Found by being asked how migrations run without terminal access, which is a question about the deployment path this
work had never actually exercised.

## Why

**`bun install --frozen-lockfile` needs every workspace manifest the lockfile mentions, not just the ones an image
uses.** Adding `packages/kit-framework` and `packages/kits` put them in `bun.lock` and made
`packages/db/package.json` depend on `@automend/kits` — so the lockfile no longer matched what any deps stage
copied, and every image failed at install. This is the first failure mode `scripts/verify.ts` lists in its own
header comment, verbatim: *"a workspace package no Dockerfile copied, so `bun install --frozen-lockfile` rejected
the lockfile in all three images."* It was written down, and I still walked into it, because I ran `typecheck`,
`check` and `test` and never ran `verify`.

**The worker also needed `packages/auth`.** Resolving a connection's OAuth token goes through Better-Auth's
`getAccessToken`, which the worker now calls — so the source has to be in the image, not merely the manifest.

**`apps/web` gets `kit-framework` and deliberately not `kits`.** The framework is types, property descriptors and
the catalogue schema, all browser-safe. A kit's code calls third-party APIs and must never reach a bundle, which is
the entire reason the catalogue is served over HTTP. The absence is load-bearing, so the Dockerfile says so.

**The YAML error was mine and the trap was documented too.** `SECRETS_KEY: ${SECRETS_KEY:?generate with: openssl
rand -base64 32}` — the colon in the message ends the mapping value. The API service already declared the same
variable, quoted and with no colon; the worker's line now matches it **word for word**, because the same variable
spelled two ways is how a deployment ends up with a worker that cannot decrypt what the API encrypted.

**And a hardcoded default I had no business adding.** `AUTH_BASE_URL: ${AUTH_BASE_URL:-http://localhost:5173}`
restated a value `config.ts` owns and `.env.example` generates. Now plain `${AUTH_BASE_URL}`, like the API's line.

## On migrations, since that was the question

**Nothing is ever run by hand.** Both compose files define a `migrate` service that runs
`packages/db/src/migrate.ts` from the API image, and `api`, `worker` and `web` all declare
`depends_on: migrate: condition: service_completed_successfully` — so a deploy applies migrations before anything
serves, and a failed migration stops the deploy rather than starting an app against the wrong schema.

`bun run db:migrate` is for working against a database *outside* the compose stack. It is a developer convenience,
and three changelog entries in this batch wrongly listed it under **Action required**. Corrected.

## What changed

- All three Dockerfiles copy `packages/kit-framework/package.json` and `packages/kits/package.json` in **every**
  deps stage — `apps/web` has two, and both install, so both need the manifests.
- `apps/api` and `apps/worker` copy the sources of both packages; `apps/worker` also copies `packages/auth`.
- `apps/web` copies `packages/kit-framework` into its build stage only, with a comment on why `kits` is absent.
- `deploy/coolify/docker-compose.yml`: the worker's `SECRETS_KEY` and `AUTH_BASE_URL` now match the API's
  declarations exactly, quoted.
- `docker-compose.yml`: the worker's `AUTH_BASE_URL` loses its invented default.
- **CLAUDE.md** now says to run `bun run verify` — not just typecheck and tests — for anything touching packages,
  Dockerfiles or compose, because those gates are the only ones that catch this class of problem.

## Action required

**None.** If you had already built images from this branch, rebuild — they would have failed anyway.

## Verification

`bun run verify` — all 9 gates, which is the thing that should have been run before any of this was called done:

```
1/9  formatting and lint ... ok
2/9  types ... ok
3/9  tests ... ok                    (444)
4/9  .env.example matches config ... ok
5/9  generated auth schema is current ... ok
6/9  compose files resolve ... ok
7/9  run persistence against a real database ... ok
8/9  container images build ... ok
9/9  migrations apply to a populated database ... ok
       1 new migration: 0006_red_vindicator.sql
       applied origin/main, seeded 10 tables, now applying this branch
```

Gate 9 is the direct answer to the question that started this: `0006` applies over `origin/main` to a database with
rows in all 10 tables, through the same containerised runner a deploy uses.
