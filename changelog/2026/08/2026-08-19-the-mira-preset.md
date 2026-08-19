# The radix-mira preset

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `apps/web`

## Summary

`shadcn apply --preset b78kCQCuck` — the style moves from `radix-nova` to `radix-mira`, the base colour
from `neutral` to `mist`, and the type from Geist to Noto Sans with IBM Plex Sans for headings. All
fourteen UI components were re-installed in the new style.

## Why

Asked for. What matters is what survived and what did not, because the CLI warns that applying a preset
overwrites components, fonts and CSS variables — and it does.

**Survived**, because they live outside the blocks the preset rewrites: `--brand`, the six `--node-*`
accents and their comments, the thin-scrollbar rules, the Preflight cursor fix and the reduced-motion
block. The node accents are the product's palette, so losing them would have been the expensive part.

**Did not survive**: `IconAction`, which lived inside `components/ui/tooltip.tsx`. It is used in six
places and its loss broke the build immediately.

## What changed

- **`components/ui/icon-action.tsx`** is new, and the fix is the move rather than the restore.
  `IconAction` is not a shadcn primitive — it is this project's composition of Button and Tooltip — and
  keeping it inside a file the CLI owns meant the next `shadcn add` or `apply` would delete it again.
  Its six call sites now import from there.
- **`TooltipProvider` at the root.** The preset's `Tooltip` no longer carries its own provider, so a
  tooltip rendered without one throws. The old one self-provided precisely so a caller could not forget;
  the new one cannot, so `__root.tsx` provides it for the whole site. Worth noting that `typecheck`,
  `build` and the test suite all passed *before* this was added — nothing but rendering catches it.
- **Geist removed.** The preset repointed `--font-sans` and `--font-heading` at the new families, which
  left Geist imported, downloaded and rendered by nothing.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun test` (615), `bun run --cwd apps/web build`, `bun run verify`.

The colours and the type are a wholesale change to every screen and have not been reviewed page by page.
The tokens are all semantic, so nothing should be unreadable — but that is reasoning, not observation.
