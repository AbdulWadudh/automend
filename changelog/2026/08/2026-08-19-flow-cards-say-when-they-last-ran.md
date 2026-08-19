# Flow cards are clickable, and say when they last ran

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`, `apps/api`, `packages/db`, `packages/shared`

## Summary

A flow card is a target across its whole surface, and its description now ends with when the flow last
ran — or "never run".

## Why

Only the title was a link, which is a small target on a wide card and gives no feedback anywhere else.
And a list of flows that never says whether any of them has *done* anything is a list of names: "last
run" is the one fact that tells you which of them are alive.

## What changed

- **One stretched link**, not a click handler on the card and not a link per region: the title's link
  carries `after:absolute after:inset-0`, so the whole card is the target while exactly one thing
  remains in the tab order saying where it goes. The Delete control gets `relative z-10`, or it would
  sit under that overlay and be unreachable.
- **`lastRunAt` on the flow listing**, from a correlated `max(created_at)` over `flow_runs`. It lives on
  a new `flowListItemSchema` rather than on `flowSchema`, because create and update return the row they
  wrote and a subquery is not part of that row — putting it on the base schema would oblige every write
  to invent a value for it.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun test` (617), `bun run --cwd apps/web build`, `bun run verify`.
`packages/db/tests/flows.test.ts` covers a flow that has never run reporting null.
