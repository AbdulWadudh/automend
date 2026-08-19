# Slack messages can carry Block Kit

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/kits`, `packages/shared`

## Summary

`slack.sendMessage` gains an optional **Blocks** field. Paste Block Kit JSON into it and Slack renders
the layout; the message field becomes the notification fallback rather than the whole message.

## Why

Block Kit JSON pasted into the message field was posted as what it is — a wall of JSON in the channel.
`chat.postMessage` renders a layout only from `blocks`, and nothing was sending that.

## What changed

- `blocks`, a `json` property. Templatable like every other JSON field, which matters more here than
  it looks: the layout is text at rest, so `{{trigger.body.name}}` inside a block resolves the same
  way it does in the message. A block full of a customer's details is the normal case.
- **Both shapes are accepted.** Slack's Block Kit Builder — where almost everybody composes these —
  copies out `{"blocks": [...]}`, while the API takes the array. Reading either is the difference
  between "works when you paste from the tool everyone uses" and not.
- **Blocks are checked, then handed on untouched.** Enough to fail usefully — an array, at most
  Slack's fifty, each element an object with a `type` — and no more. A schema that rebuilt each block
  would silently drop every field it had not been taught, and Slack adds block types faster than this
  kit will be edited. The failure names the block by position, because a person looking at forty of
  them needs to know which one; Slack's own `invalid_blocks` names neither the field nor the block.
- **`text` is still required and still sent**, alongside `blocks` rather than instead of them. It is
  what Slack shows in notifications and anywhere the layout cannot render, so a message without it
  pings people with nothing readable in the ping.
- An empty blocks field means *no blocks*, not `blocks: []` — Slack accepts the latter and posts an
  empty message.

## Action required

**None.** No new environment variable, no migration, and no re-authorisation: `chat:write` already
covers this. Existing steps are unaffected — the field is optional and absent means what it did before.

## Verification

`bun run verify` — all nine gates.

Run rather than reasoned about: a stored step carrying Block Kit Builder output with `{{...}}` inside
it was pushed through the engine's real `resolveStepInput` and then through the action, and the body
that reached the HTTP client was checked. The variable resolved *inside* the block, and both `text`
and `blocks` were present.

`packages/kits/tests/slack/blocks.test.ts` covers both accepted shapes, unknown fields surviving,
each empty case, and the three failures. `send-message.test.ts` covers the layout reaching
`chat.postMessage` beside the text, and a malformed layout failing before the request is made.
