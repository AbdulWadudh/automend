# Both operator consoles open in a new tab

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/web`

## Summary

The queue dashboard now opens in a new tab, like the database studio beside it already did.

## Why

The two cards on the Operations page behaved differently for no reason a reader could see: the
studio is on its own origin so it always opened in a new tab, while the queue dashboard is served by
the API on this origin and replaced the app. Leaving the console meant using the browser's Back
button, because the dashboard is not part of the SPA and has no way back into it.

## What changed

`Open queues` gains `target="_blank" rel="noreferrer"` and the same external-link icon the studio
link carries, so the two controls look alike because they now behave alike.

## Action required

**None.**

## Verification

Opened both consoles from the Operations page.
