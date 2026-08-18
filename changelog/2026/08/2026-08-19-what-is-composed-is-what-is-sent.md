# What is composed in the rich field is what gets sent

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`, `packages/shared`, `packages/kits`

## Summary

An email body written with one blank line between paragraphs arrived with roughly three. Lexical writes the
editor theme's **Tailwind class names** into its HTML export, and a class name is worth nothing once the body
leaves the app. The export now carries inline styles, and the Gmail kit applies the same normalisation at send —
so bodies already stored are fixed without anybody re-saving them.

## Why

The stored body looked like this:

```html
<p class="mb-1 last:mb-0">Hi {{trigger.body.name}},</p>
<p class="mb-1 last:mb-0"><br></p>
```

`mb-1 last:mb-0` comes from `EDITOR_THEME.paragraph`, and `$generateHtmlFromNodes` writes theme classes into its
output. In an email client there is no Tailwind, so:

- `mb-1` (4px) is **dropped**, and the client's own default paragraph margin applies — about 16px top *and*
  bottom;
- the empty `<p><br></p>` becomes a full paragraph carrying those same margins.

One blank line therefore rendered as roughly three, and 4px gaps became about 48px. The load-bearing half of the
fix is **zeroing the top margin**: `mb-1` only ever set a bottom one, so the space nobody could account for was
the default *top* margin showing through the moment the class was ignored.

This is the same shape of bug as the variable picker: two halves each self-consistent — a theme that styles the
editor, an export that emits class names — with nothing asserting they agree once the content travels.

## What changed

- **`packages/shared/src/rich-text.ts`** — new. `toEmailSafeHtml` translates the theme's classes into inline
  declarations, merges them *under* whatever `style` the element already carried, and drops the class. It lives in
  `shared` rather than beside the editor for one reason: `packages/kits` needs it too, and `shared` is the only
  place both the builder and a kit may import from.
  - The element's own style wins on a conflict. Lexical writes `white-space: pre-wrap` there to preserve typed
    spaces, and alignment and indent the same way; those describe the content, while a theme class describes the
    default.
  - A string transform rather than a DOM walk, deliberately: the input is *generated* by Lexical, so its tags are
    well-formed and its text is escaped — `<` in a body arrives as `&lt;`, which is why matching on `<tag …>`
    cannot collide with the body's own text. It also keeps the function pure and testable without a DOM, where
    `DOMParser` exists only in the browser.
- **`apps/web/src/components/flows/template-field/rich-text-styles.ts`** — new; owns `EDITOR_THEME`, moved out of
  the component so the theme and its translation can be held side by side by a test.
- **`apps/web/…/template-content.ts`** — `$readRichContent` passes the export through the transform, so what is
  *saved* is already email-safe.
- **`packages/kits/src/gmail/common/mime.ts`** — `buildRawMessage` normalises an HTML body as well, at the last
  point before the MIME is assembled. This is what fixes a body stored before any of the above existed: nothing
  rewrites stored HTML, so the send path has to cope with it. A plain-text body is untouched — there is no markup
  to normalise and rewriting text somebody typed would be a bug of its own.

## Action required

**Restart the worker.** `packages/kits` changed, so the send-time normalisation only takes effect on a restart.
No environment variable, no migration, no re-saving of flows.

## Verification

`bun run verify` — all nine gates, 561 unit tests, 22 of them new.

- **The invariant that would have caught this** asserts the theme and its translation stay paired, in *both*
  directions: a class added to the theme without an equivalent fails, and so does a dead entry with no class
  behind it. An entry may be deliberately empty — `last:mb-0` has nothing to say outside the editor — and saying
  so explicitly is how the test tells "no equivalent needed" from "nobody thought about it".
- **Against the exact body from the report**: all five paragraphs come out carrying `margin: 0 0 4px`, none
  carries a class, the single blank line stays a single blank line, and the typed spaces and every `{{token}}`
  survive.
- **Through the kit, decoded off the wire**: the base64 body inside the assembled MIME message contains
  `margin: 0 0 4px` and no `class=`, which is what proves the fix reaches the recipient rather than only the
  database.
