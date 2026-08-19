# An account menu in the sidebar

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`

## Summary

The sidebar's account row opens a menu: Profile, the three theme choices, and Sign out. The rule above
it is gone.

## Why

Sign out and the theme both lived only on the Profile page, so the two things people do most often
took a navigation each. The account row was already the right place to put them — it just went
somewhere instead of offering anything.

The separator went because of what it looked like collapsed: `SidebarFooter` already sits against the
sidebar's own edge, so the rule was a second, shorter line beside it — and once the sidebar narrows to
the icon rail it became a stub floating next to the avatar.

## What changed

- **`components/ui/dropdown-menu.tsx`** from the CLI, in the current style.
- The footer's row is now the menu's trigger, with a chevron so it reads as one. The menu opens to the
  **side**, not upward: the footer is at the bottom, and a menu opening up would cover the navigation
  somebody just came from.
- The theme choices are a `DropdownMenuRadioGroup` bound to the same `lib/theme.ts` the Profile page
  uses, and the list is built from one array so the two surfaces cannot drift into different options.

## Action required

**None.**

## Verification

`bun run typecheck`, `bun run check`, `bun test` (616), `bun run --cwd apps/web build`, `bun run verify`.
