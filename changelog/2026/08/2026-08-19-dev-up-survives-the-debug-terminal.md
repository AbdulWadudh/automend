# dev:up survives the debug terminal

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `scripts`, `.vscode`

## Summary

`bun run dev:up` no longer dies at the migration step when started from VS Code's debug terminal,
and `.vscode/launch.json` now debugs the api and the worker as two separate sessions rather than
contending for one inspector port.

## Why

The debug terminal exports `BUN_INSPECT*` so the process it starts serves a debugger on one fixed
port. `Bun.spawn` inherits the environment, so every bun this script starts inherits the *same*
port — and the second one to reach it dies with `EADDRINUSE`.

What made it expensive to diagnose is where it surfaced. The failure came out of `db:migrate` as
`Failed to start inspector`, and `dev-up.ts` reported it as `migrations exited 1` with a hint to
check `DATABASE_URL` — pointing at the database, which was fine. Nobody steps through a migration
from here anyway, so the inspector has no business being inherited by these children.

## What changed

- `environmentWithoutInspector()` in `scripts/dev-up.ts`, used by both `capture` and `forward`.
  Matched by the `BUN_INSPECT` prefix rather than by naming each variable, so it holds if Bun adds
  another.

## Debugging the api and the worker together

The debug terminal is the wrong tool for it, and no fix to this script would change that: it pins
one inspector URL for everything started inside it, so `bun run --filter '*' dev` puts the api,
worker and web on the same port and the last two lose.

`.vscode/launch.json` runs them as two separate debug sessions instead — **Debug api**, **Debug
worker**, and a **Debug api + worker** compound that starts both. Each session gets its own
inspector, which is what makes them coexist:

```
api     ws://localhost:6499/krxhxp8s41
worker  ws://localhost:6499/r2gh0w63ct9
```

Start the backing stores with `bun run dev:up` first; the launch configs only run the apps, the
same division `dev:up` already documents. `launch.json` is un-ignored in `.gitignore` so the
configuration is shared rather than re-invented per machine.

Two things worth knowing:

- Neither config passes `--hot`. Reloading a module out from under a paused debugger is how
  breakpoints stop being hit; set `"watchMode": "hot"` if you would rather have reload than
  reliable breakpoints.
- Debugging the worker does not disturb flow execution. The engine subprocess is spawned with an
  allowlisted environment (`buildChildEnv` in `apps/worker/src/engine/step-host.ts`) that does not
  include `BUN_INSPECT`, so it cannot inherit the session's inspector.

An orphaned bun holding the inspector port makes *every* subsequent run fail this way, including
the first process. `dev:up` cannot offer to free it the way it does for the app ports, because the
port is chosen per debug session rather than fixed.

## Action required

**None.**

## Verification

A/B run of `bun run dev:up` with `BUN_INSPECT` set and the inspector port free:

- without the change — `error: script "db:migrate" exited with code 1`, `EADDRINUSE`;
- with it — `migrations applied`, `Ready.`

`bunx biome check`, `bun run typecheck` and `bun test` (635 pass) all clean.
