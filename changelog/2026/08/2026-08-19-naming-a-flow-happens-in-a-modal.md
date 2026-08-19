# Naming a flow happens in a modal, and ends on the canvas

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `apps/web`

## Summary

"New flow" opens a dialog for the name and then navigates straight into the flow, instead of a field
in the page header that left you looking at a list with one more card in it.

## Why

Creating a flow is a step on the way to editing one, so the list was the wrong destination. The
header field also made the page look like its own primary job was typing a name, and it was the first
thing on a page whose actual subject is the flows below it.

## What changed

- `NewFlowDialog` owns the name, the mutation and the navigation; the page owns only whether it is
  open, so the header button and the empty state's call to action open the same one.
- Dismissing clears the draft name — reopening to a half-typed name from an hour ago is memory nobody
  asked for.
- The empty state gained a real button rather than only telling you to use a field elsewhere.

## Action required

**None.**

## Verification

`bun run check`, `bun run typecheck`, `bun test` (618), `bun run --cwd apps/web build`.
