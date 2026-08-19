# A run opens beside the feed

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`

## Summary

Clicking a run in the activity feed opens it in a drawer instead of navigating away. The page at
`/app/runs/<id>` still exists and shows exactly the same thing.

## Why

Reading a run is almost always a comparison — this one failed, did the one before it? Navigating away
to answer that costs the list you found it in, and the filters and the page you had loaded with it.
The builder already shows a node's settings beside the canvas for the same reason.

## What changed

- **A resizable panel, not a modal drawer.** The first attempt used a `Sheet`, which dims and blurs
  everything behind it — which is exactly wrong for a view whose purpose is comparing one run against
  the list it came from. It is now the same arrangement as the flow builder: a draggable split with no
  overlay, its width remembered.

- **`components/runs/run-detail.tsx`** holds the header and the timeline, and both frames render it.
  Shared rather than duplicated because the drawer and the URL are the same run seen through different
  frames — a drawer showing a subset would quietly make the deep link the "real" one.
- The feed's row is a **button**, not a link, since it no longer navigates, and the open row is marked
  so the panel beside it is visibly *that* row's run. The route stays because a run is a thing people
  send each other, and the "Open a run by id" box still goes there.
- **On a narrow screen it navigates instead.** A panel beside a feed needs width that is not there, and
  the page already exists.
- `headingClass` is the only thing the two frames differ on: a drawer's title sits at the scale of the
  panel it is in, not at the scale of a page.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun test` (617), `bun run --cwd apps/web build`, `bun run verify`.
