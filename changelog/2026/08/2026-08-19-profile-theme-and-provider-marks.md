# A profile page, a theme choice, and real provider marks

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`, `packages/shared`

## Summary

The sidebar's footer is now the signed-in account — avatar, name, email — and it opens a Profile page
carrying the account details, a light/dark/system theme choice, and Sign out. The Connections page shows
each provider's actual mark instead of the same generic glyph four times.

## Why

The footer was an email in muted text above a Sign out row: it named the account without being a way to
*do* anything with it, and it was the only place a signed-in person could go. A profile destination gives
the settings that have nowhere else to live — starting with the theme, which until now was `class="dark"`
hardcoded in `index.html` with no way to change it.

## What changed

- **`lib/theme.ts`** — the choice, applied and remembered. `system` keeps listening to
  `prefers-color-scheme` rather than resolving once, so a machine that switches at sunset switches the app
  with it instead of holding whatever it was when the tab opened. Unwritable storage (private browsing)
  degrades to a per-tab choice rather than throwing.
- **The theme is applied before first paint**, by a small inline script in `index.html` ahead of the
  bundle. Applying it from React arrives a frame late, which is a visible flash of the wrong colours on
  every load. That script cannot import config, so it repeats the storage key and the class as literals —
  and `apps/web/tests/theme.test.ts` fails if either drifts from `config.webClient.theme`, which is what
  makes the repetition safe rather than a trap.
- **`routes/app/profile.tsx`** — account details, the theme choice, and Sign out in a section of its own,
  because it is the one control on the page with a consequence. The selected theme carries a tick as well
  as a highlight; selection must not be conveyed by colour alone.
- **`components/connections/provider-icon.tsx`** — official marks from `@icons-pack/react-simple-icons`
  for Google and Discord, the interface's own key icon for `api-token` (a bearer token is not a brand),
  and a lettermark for anything else.

  **Slack is deliberately a lettermark.** Simple Icons no longer ships Slack's logo because Slack asked
  for it to be removed, and redrawing a brand mark from memory is exactly the misuse that removal is
  about. A lettermark reads as deliberate; a wrong logo reads as broken. Dropping the official asset in
  later is a line in `BRAND_MARKS`.

## Action required

**None.** New dependency: `@icons-pack/react-simple-icons`.

## Verification

`bun run typecheck`, `bun run check`, `bun test` (615), `bun run --cwd apps/web build`, `bun run verify`.

One thing worth knowing rather than discovering: the theme class goes on `documentElement`, so the
**marketing pages follow it too**. Every colour on them already comes from a token that has a light value,
so this should be correct — but light mode has not been looked at page by page, and that is the place to
check first if something reads oddly.
