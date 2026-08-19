# Long text is plain unless a kit asks for formatting

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `packages/kit-framework`, `packages/kits`, `apps/web`

## Summary

`Property.longText` gains `rich`, defaulting to false. Only `gmail.sendEmail`'s body declares it.
Every other long text field is now a plain editor storing plain text.

## Why

Every `longText` rendered as a rich editor, and a rich editor stores **HTML**. That is right for one
field in the catalogue and wrong for the other three:

- `http.request`'s body says "Sent as-is" in its own description, and was sending `<p>{"id":1}</p>`;
- `core.log`'s message was writing markup into the run journal;
- `slack.sendMessage`'s text is mrkdwn, which Slack would have posted with the tags visible.

Found while adding Slack's message field, which is what made it obvious that the flag was inverted:
formatting is the special case, not the default. A field that stores markup should have to say so.

## What changed

- `rich` on the long-text spec, carried through the catalogue so the builder knows. It is not
  presentational — the value's *type* differs — which is why it crosses to the browser rather than
  being decided there.
- `gmail.sendEmail`'s body declares `rich: true`. It is the field this behaviour was built for: it
  has its own `bodyType` selector and `toEmailSafeHtml` inlines the editor's classes on the way out.

## Action required

**None required, but check anything already typed into an `http` request body or a `core.log`
message.** A value saved through the old rich editor is HTML and will now show as its own markup in
the field rather than being silently sent as markup. That is the bug becoming visible, not a new one
— retype the field and it is fixed. Nothing rewrites stored values, deliberately: guessing at which
stored strings were meant as markup would be worse than showing them.

## Verification

`bun run verify` — all nine gates. `packages/kit-framework/tests/property.test.ts` asserts the
default is plain, so markup can no longer arrive by forgetting, and that `rich: true` is honoured.
