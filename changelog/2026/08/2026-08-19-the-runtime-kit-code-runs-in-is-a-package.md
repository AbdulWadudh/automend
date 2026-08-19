# The runtime kit code runs in is a package

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `packages/kit-runtime`, `apps/worker`, `apps/api`, `apps/web`

## Summary

The subprocess half of the engine moves out of `apps/worker/src/engine/` into a new
`packages/kit-runtime`. No behaviour changes; this exists so the api can use the same isolation.

## Why

Non-negotiable rule 1 says kit code never runs in an app's main process, and names the worker's
engine subprocess as where it does run. The rule is about the code, not about who called it: loading
a dynamic dropdown's options is kit code against a live credential, and it needs the same child with
no database client, no secrets key and an allowlisted environment. The api is about to need it.

`packages/*` may not depend on an app, so the api could not reach the child where it lived. Moving it
is the only shape that keeps both rules — the alternative was running loader code in the api process,
which is precisely what rule 1 forbids.

## What changed

- `channel`, `protocol`, `ssrf-guard`, `http-client` and `child` move verbatim. They already imported
  nothing but `kit-framework`, `kits` and `shared`, which is what made the seam obvious.
- The DAG walk stays in the worker. `executor`, `step-host`, `resolve-input` and `rate-limiter` are
  parent-side and two of them need Redis or the database, so they do not belong in a package.
- `CHILD_ENTRY` moves with the child and is exported. It used to be resolved from `step-host.ts` via
  `import.meta.url`, which stops being correct the moment the child is not its neighbour.
- Named `kit-runtime` rather than `engine`, to pair with `kit-framework`: the framework is what a kit
  is *written against* and is browser-safe; this is where kit code is *executed* and must never reach
  a bundle. `apps/web`'s Dockerfile therefore copies its manifest but not its source, for the same
  reason it already excludes `packages/kits`.

## Action required

**None.** No schema, config or environment change.

## Verification

`bun run verify` — all nine gates, and gate 8 is the one that matters here. A new workspace package
is the failure that script names first in its header: `bun install --frozen-lockfile` validates the
whole lockfile, so every `Dockerfile` — including both install stages in `apps/web` — needs the new
manifest or no image builds. 640 tests pass unchanged, which is the point of a move.
