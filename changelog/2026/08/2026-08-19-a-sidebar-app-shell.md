# A sidebar app shell

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `apps/web`

## Summary

The app moved from a top nav bar to a collapsible sidebar. Navigation, the workspace name, the signed-in
account and Sign out all live in it; the page region beside it is what scrolls.

## Why

The top bar gave the product one row for navigation and left everything else to a narrow centred column,
so on a wide screen most of the window was empty and the nav had nowhere to grow. A sidebar is the
pattern for this shape of app — a handful of top-level sections that persist while you work inside one —
and it is what the design guidance recommends above 1024px.

It also makes room for what is coming: sections are grouped, so a fifth destination is a line in a list
rather than another item competing for horizontal space.

## What changed

- **`components/ui/sidebar.tsx`** and its dependencies (`sheet`, `separator`, `skeleton`,
  `hooks/use-mobile`) come from `bunx shadcn add sidebar`, in this project's existing `radix-nova` style.
  Nothing already in `components/ui` was overwritten and no dependency was added — the unified `radix-ui`
  package already had what Sheet needed. It is vendored CLI output, so it is left as generated: it is over
  the file-length guideline and carries three Biome *warnings* (`document.cookie`, two exhaustive-deps),
  which is the price of being able to run `shadcn add` again later without a merge.
- **`components/app/app-sidebar.tsx`** replaces `app-header.tsx`. Two groups, because primary and
  secondary navigation should not read as one list: *Workspace* (Flows, Runs, Connections) and
  *Operating* (Operations), the second still appearing only on a deployment that configured a console.
- **The active item is marked, and stays marked two levels down.** `/app/runs/<id>` keeps *Runs* lit,
  which is what tells you where you are once a page has its own back link.
- **Collapsed to icons, each item keeps its name** as a tooltip, because an icon-only rail is
  undiscoverable without one. Sign out sits at the bottom, apart from the destinations.
- **`routes/app.tsx`** keeps the shell's scroll contract intact: the provider is `h-dvh min-h-0
  overflow-hidden` rather than its own `min-h-svh`, and the inset is `min-h-0 overflow-hidden`. Getting
  either wrong makes the *document* scroll, which drags the sidebar and the flow canvas off-screen — the
  exact failure the old shell's comment warned about.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun run --cwd apps/web build`, and `bun run verify`. Rendering was
confirmed in the running dev server rather than by inspection.
