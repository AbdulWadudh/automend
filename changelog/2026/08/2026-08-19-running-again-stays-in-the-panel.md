# Running a run again stays where you started it

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/web`

## Summary

Pressing **Run again** on the runs dashboard now opens the new run in the panel beside the feed,
the same way clicking a row does. It no longer navigates to the dedicated run page and takes the
feed, the filters and the summary with it.

## Why

`RetriggerButton` decided for itself where the new run opened, and the only thing it knew how to do
was `navigate` to `routes.runDetail`. That was right on the run *page*, where there is no other
frame to stay in, and wrong everywhere else: the dashboard had just been built around a resizable
panel precisely so that looking at one run does not cost you the feed it was found in — and
retriggering threw that away on every press, from the row *and* from inside the panel itself.

A control that navigates out of the frame it is rendered in cannot be reused across frames. So the
button stops choosing, and the caller places the result.

## What changed

- `RetriggerButton` takes an optional `onStarted(runId)`. Given one, it hands the new run's id to
  the caller; without one it keeps navigating to the run page, which is what `/app/runs/$runId`
  wants.
- `RunDetail` takes `onRunStarted` and forwards it, so the shared component behaves as its frame
  needs — the drawer swaps to the new run, the page navigates.
- On the dashboard both the row button and the panel pass `openRun`, the same handler the row click
  uses. That keeps one rule for where a run opens, including the narrow-screen case where `openRun`
  navigates because there is no room for a panel.

## Action required

None.

## Verification

`bun run typecheck` (`@automend/web` clean) and `biome check` on the four changed files.
