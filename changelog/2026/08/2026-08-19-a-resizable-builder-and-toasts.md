# A resizable builder, toasts, and a calmer opening view

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`, `packages/shared`

## Summary

The flow builder's canvas and inspector are now a draggable split that remembers the width you set.
Actions that used to succeed silently say so, through toasts. The canvas opens zoomed out rather than
filling itself with two nodes.

## What changed

- **`components/ui/resizable.tsx`** — `shadcn add resizable`, on `react-resizable-panels` v4. Two API
  differences worth knowing, because both fail quietly rather than loudly: the group takes
  `orientation`, not `direction`, and a **bare number size is pixels** — a unitless *string* is the
  percentage. `defaultSize={62}` is a 62-pixel canvas, so the sizes in config are strings.
- **Two layouts rather than one that adapts.** A drag handle between a canvas and a 26rem panel is not
  a thing on a phone, so below `lg` the panels still stack and the column scrolls. `useIsMobile` picks
  between them, because the two genuinely need different DOM.
- **The split is saved** with `useDefaultLayout`, listing `panelIds` explicitly — the webhook drawer is
  a conditional panel, and without the ids a restored layout is applied to a different set of panels
  than it was written for.
- **`fitViewMaxZoom`** caps how far the opening `fitView` may zoom *in*. Without a ceiling a two-node
  flow fills the canvas, so the first thing anybody did on opening one was zoom out to find room.
- **Toasts.** `sonner`, with `richColors` and an icon per level, since a failure should not look like a
  success and colour alone should not be what says which. The generated component reads the theme from
  `next-themes`, which this app does not use — it is rewired to `lib/theme.ts`, and `next-themes` was
  removed rather than left installed for one import.

  Wired to the actions that changed something and said nothing: saving a flow, creating and deleting
  one, and retriggering a run — which navigates away, so without a toast the new run simply appeared.
- **Motion, kept to the rules**: a 200ms fade as a page's content arrives, and a one-pixel lift on a run
  row under the pointer. Opacity and transform only, and the existing `prefers-reduced-motion` block
  already neutralises both.

## Action required

**None.** New dependencies: `sonner`, `react-resizable-panels`.

## Verification

`bun run typecheck`, `bun run check`, `bun test` (615), `bun run --cwd apps/web build`, `bun run verify`.
The split, the drag handle and the zoom were confirmed in the running dev server.
