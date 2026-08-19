# Only the part that grows scrolls

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/web`, `CLAUDE.md`

## Summary

The runs dashboard and the run detail no longer scroll as a single block. The window summary stays
above the feed while the rows scroll, and a run's status, ids and facts stay above the timeline while
the timeline scrolls. `CLAUDE.md` gains the rule this is an instance of.

## Why

Making a panel a scroll container is only half the decision — *where inside it the split goes* is the
other half, and it was being skipped. Wrapping a whole panel in one `overflow-y-auto` scrolls its head
along with its rows: the filters you are narrowing by leave the screen as you scroll the results of
narrowing, and a run's status and failure slide away while you read the timeline you opened them for.
Content moving is scrolling; the frame around it moving is the interface losing its place.

The existing rule ("the panel scrolls, never the page") was satisfied by both arrangements, which is
why the wrong one passed review. The new rule names the split explicitly.

## What changed

- **`CLAUDE.md`** — a new non-negotiable under *Interface quality*: a panel is `flex flex-col`, its
  head is `shrink-0`, and below it sits exactly one `min-h-0 flex-1 overflow-y-auto` body holding only
  the variable-length content. Nothing that names, summarises, filters or acts on that content goes in
  the body. A head that can itself grow without bound gets bounded rather than allowed to squeeze the
  body to nothing.
- **`RunList` and `RunDetail` take a `className` and get their height from the caller.** Bounded, they
  scroll their own body; left unbounded they simply grow. That is what lets the same component pin its
  head inside a drawer and scroll as part of the page on a phone, with no second code path.
- **`runs/index.tsx`** — the title, window picker, totals and by-flow table are a `shrink-0` band; the
  feed below it is the page's only scroll container. On a narrow screen the band would leave the feed
  two rows, so there the page stays one scroll region.
- **`FlowStatsTable` is bounded (`max-h-64`) with a sticky, opaque header**, since it sits in that band
  and a workspace with many flows would otherwise crowd the feed out. `bg-muted/40` became `bg-muted`
  because a translucent sticky header shows the rows passing under it.
- **`$runId.tsx`** mirrors the drawer: the "← Runs" link and the run header are fixed, the timeline
  scrolls.
- A rule between each head and its body, and padding inside the scroll bodies, so rows do not appear
  clipped at the boundary and the scrollbar does not sit on a card's ring.

## Action required

**None.**

## Verification

`bun run check`, `bun run typecheck`, `bun test` (617), `bun run --cwd apps/web build`.
