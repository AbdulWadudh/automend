# Flows and connections are card grids

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `apps/web`

## Summary

Both lists are now responsive card grids rather than stacked full-width rows, and `connections.tsx`
is split into components. Designed against the `ui-ux-pro-max` skill, as `CLAUDE.md` requires for
anything past a small tweak.

## Why

A full-width row per item wastes most of a wide screen and reads as a table that forgot its columns.
Cards give each item a fixed shape, which is what lets the grid reflow from one column on a phone to
three on a desktop without any item changing meaning.

`connections.tsx` was also 548 lines, well past the ~300 the coding standards allow, and the rebuild
was the moment to split it rather than a reason to grow it further.

## What changed

- **`components/flows/flow-card.tsx`** — the flow's trigger kit supplies the icon and the accent, so
  a flow started by Gmail looks the same here as its node does on the canvas. Footer carries step
  count, when it was edited, and whether it has ever run.
- **`components/connections/connection-card.tsx`** and **`connector-card.tsx`** — extracted from the
  route, which is now 177 lines and only assembles the page.
- **`lib/connect-oauth.ts`** — `startOAuthConnection` and `CONNECTED_PARAM` now have a home both cards
  can import, instead of living in the route that used to own them.
- **Delete is an `AlertDialog`**, not the row swapping itself for two buttons. Both destructive
  confirmations keep their words and say what is lost. On a flow card the trigger stays hidden until
  hover or focus, so a grid of cards is not a grid of delete buttons — `group-focus-within` is what
  keeps it reachable from a keyboard.
- **Destructive confirmations wear the destructive variant.** `AlertDialogAction` defaults to
  `default`, which painted "Remove for good" and "Delete for good" in the brand green — the same
  colour as every safe primary action in the app. Retriggering a run keeps the default variant, since
  starting a run is not destructive.
- **Skeletons shaped like the cards** replace the "Loading…" text, so nothing moves when data lands.
- **Empty states say what to do next** rather than being an empty card with a title.
- Scopes are individual tags rather than a comma-joined string, so a row of them wraps at the value
  boundary instead of mid-URL. They are plain `span`s: a scope is a value nobody presses.
- **Every edit is a modal.** Adding a token, renaming a connection and replacing a token were inline
  regions that doubled a card's height and shoved the rest of the grid down — and a field that
  replaces a label under the pointer is the thing that reads as broken. `components/ui/dialog.tsx` is
  written by hand rather than pulled from the shadcn CLI, which insists on overwriting `button.tsx`
  and this codebase's own size scale with it. `Dialog` is for a task, `AlertDialog` stays for a
  decision, and the two share an overlay, radius and motion so they read as one product.
- **Provider marks wear their real colours, on a white tile in both themes.** A brand's colours are
  chosen against white, so they cannot serve two surfaces: measured against this app's `muted`,
  Google's blue is 2.80:1 in light mode and Slack's aubergine 1.85:1 in dark — an invisible logo
  either way. On white every mark clears 3:1 in both themes (Google 3.56:1, Discord 4.61:1, the
  near-black marks far higher), which is the background their guidelines assume anyway.
- **One rule for company marks, written down in `provider-icon.tsx` so a new connector never needs it
  decided again**: a genuinely multi-colour logo uses a faithful multi-colour glyph; anything else uses
  the single-path mark tinted with the brand's *own* exported hex; and where no package ships the mark
  at all, a lettermark in the brand's colour. Never a redrawn logo. Slack is that last case — it asked
  Simple Icons to withdraw its logo and react-icons' snapshot has none either (the only `SiSlack*`
  export anywhere is Slackware), so it gets an aubergine letter rather than a borrowed glyph.
- **`react-icons` joins the dependencies, for `FcGoogle` only.** Google's G is four colours, and Simple
  Icons draws it as a single path — tinting that path any one colour is the wrong logo. Marks that
  really are monochrome keep coming from Simple Icons with the brand's own hex, so `BrandMark.hex` is
  optional: present for a single-path mark, absent for one that carries its own colours. Tree-shaking
  keeps the cost to +0.4 kB gzipped.
- Every badge carries an icon as well as a tint — "Never run", "Not configured", OAuth vs Token —
  since none of them may rest on colour alone.

## Action required

**None.**

## Verification

`bun run check`, `bun run typecheck`, `bun run --cwd apps/web build`. Palette and contrast decisions
came from the design skill's own guidance rather than being chosen by eye.
