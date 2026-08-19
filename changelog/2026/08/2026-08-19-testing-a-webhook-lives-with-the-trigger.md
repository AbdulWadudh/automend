# Testing a webhook lives with the trigger

- **Date:** 2026-08-19
- **Type:** refactor
- **Scope:** `apps/web`

## Summary

**Test webhook** moved out of the builder's toolbar and into the trigger panel, under the URL it
tests — it appears when the selected trigger listens on a URL, and not otherwise. The slot it left
in the toolbar is now **View runs**, which opens the runs dashboard filtered to this flow.

## Why

The toolbar is where controls that act on the *whole flow* go — Save, the shortcuts, the flow's
history. Test webhook was never one of those: it acted on a single node, and it proved it by
appearing and disappearing from the bar as the trigger changed underneath it. A control that
blinks in and out of a row of stable actions reads as a bug, and it sat nowhere near the address
it sends to, so testing the hook meant looking at the panel and reaching for the toolbar.

Putting it under `WebhookUrl` makes the panel say the whole thing in one place: here is the
address, here is whether it is live yet, here is a request to send at it.

## What changed

- `NodeInspector` takes `isTestingWebhook` and `onTestWebhookChange` and forwards both to
  `TriggerSection`, which renders the toggle beneath `WebhookUrl` under the same
  `summary?.strategy === "webhook"` condition the URL already uses. Selection alone therefore
  decides whether the button exists — no second visibility rule to keep in step.
- The drawer's open state still lives in the route, because the drawer is a sibling panel of the
  inspector rather than a child of it. `draftWebhookPath` still gates the panel, so switching the
  trigger away from a webhook closes it.
- The toolbar's runs link is now labelled **View runs** and rendered as `outline` rather than
  `ghost` — it inherits the emphasis of the slot it took over, and it is the only route out of the
  builder that stays about this flow.

## Action required

None.

## Verification

`bun run --filter '@automend/web' typecheck`, `biome check` on both changed files, and
`bun run --cwd apps/web build`, whose `_flowId` chunk carries both labels from their new homes.
