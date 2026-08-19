# A flow's runs are one click away

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`

## Summary

A flow card and the flow builder both link to the runs feed narrowed to that flow. Making that
possible meant moving the feed's filters out of component state and into the URL.

## Why

Nothing outside the runs page could open it filtered, because the filters were `useState`. That also
meant a filtered feed could not be refreshed, bookmarked or sent to anybody — the same argument the
run detail page already won when it kept its own route: a view people compare things in has to have
an address.

## What changed

- **`/app/runs` validates a `flowId` and `status` search.** `safeParse`, not `parse`: a stale or
  hand-edited link lands on the unfiltered feed rather than an error boundary, because dropping a
  filter is recoverable and refusing to render is not. Filter changes navigate with `replace`, so
  narrowing does not stack a history entry per filter tried.
- The by-flow table's existing "Show runs" button became shareable for free, since it now writes the
  same search.
- **The flow card carries a `Runs` button, and a separate badge for whether it has run.** The first
  attempt made the badge itself the link, which is why it could not be found: a chip that reports
  state and a chip that navigates look identical. Badge reports, button navigates.
- The button is present even when a flow has never run. One card with a button beside one without
  reads as the feature being missing rather than as a state, and an empty feed is itself the answer
  to "has this ever done anything".
- **The builder header carries the same link**, beside Save — editing a flow and checking what it did
  are one loop. `Test webhook` moved into that group too; it was stranded on the left of the name
  field while every other action sat on the right.
- The card's footer is two fixed rows rather than one that wraps. Wrapping made its height depend on
  how long "edited 8 hours ago" happened to be, so one card kept everything on a single row while its
  neighbour pushed the badge onto a second.

## Action required

**None.** Existing `/app/runs` links keep working; the search is optional.

## Verification

`bun run check`, `bun run typecheck`, `bun test` (618), `bun run --cwd apps/web build`.
