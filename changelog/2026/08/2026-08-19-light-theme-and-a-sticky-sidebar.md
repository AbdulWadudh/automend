# The canvas follows the theme, and the sidebar remembers itself

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `apps/web`, `packages/shared`

## Summary

The flow canvas stayed dark under the light theme. It now follows the choice, as does the browser's own
chrome. The sidebar's collapsed state survives a reload.

## Why

Both are the same shape of bug: something was persisting or theming *itself* correctly, and nothing was
reading the answer back.

**The canvas** had `colorMode="dark"` hardcoded, with a comment explaining that the app rendered dark
throughout. That was true when it was written and stopped being true the moment the theme became a
choice — so a light app had a black rectangle in the middle of it. React Flow paints its own pane,
controls, edges and attribution from `colorMode` rather than from our tokens, so it has to be told;
`system` is a value it understands, so the app's three choices map straight onto it.

**The sidebar** already wrote a `sidebar_state` cookie on every toggle. Nothing read it, because
reading it is a server-side step in the Next.js app the component was written for, and this is a
single-page app — so it re-opened expanded every time, having faithfully recorded that it should not.

## What changed

- **`colorMode={theme}`** on the canvas, from `lib/theme.ts`.
- **`lib/sidebar-state.ts`** reads the cookie the sidebar writes and feeds it to `defaultOpen`. The
  name lives in `config.webClient.sidebar` and mirrors a constant inside the vendored component, which
  is not ours to export — `tests/sidebar-state.test.ts` fails if the CLI regenerates it with a
  different one, the same guard the pre-paint theme script has.
- **Two `theme-color` metas** with `prefers-color-scheme` media, instead of one fixed dark value.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun test` (616), `bun run --cwd apps/web build`, `bun run verify`.

The rest of light mode was checked by grep rather than by eye: the only hardcoded colours left are
Google's brand hexes in the sign-in mark, which are meant to be fixed, and the `bg-black/50` scrims on
the dialog and sheet, which are shadcn's own and read correctly in both themes.
