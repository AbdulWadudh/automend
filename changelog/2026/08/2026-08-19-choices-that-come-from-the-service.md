# Choices that come from the service

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/kit-framework`, `packages/kit-runtime`, `packages/kits`, `packages/auth`, `packages/shared`, `apps/api`, `apps/web`

## Summary

`Property.dynamicDropdown` exists. A kit declares a loader, the api runs it in the sandboxed
subprocess with the step's connection, and the builder renders a searchable picker. Slack's
`sendMessage` uses it: the channel field is now a list of the workspace's channels rather than an id
somebody has to go and find.

## Why

`Property.staticDropdown` carried the note that "choices that have to be fetched from the service — a
Slack channel, a spreadsheet tab — are a dynamic dropdown, which does not exist yet". This is that.

The load-bearing constraint is where the loader runs. It is kit code holding a live credential, so
non-negotiable rule 1 applies exactly as it does to a step: not in the api's process, which holds
`DATABASE_URL` and `SECRETS_KEY`. That is why `packages/kit-runtime` was extracted first — the api
spawns the same child a run does, with no database client and an allowlisted environment.

## What changed

- **`Property.dynamicDropdown({ loadOptions, dependsOn })`.** `loadOptions` gets a narrower context
  than a step does — no run, no store, no idempotency key — because listing what a service holds is
  not part of any execution. `dependsOn` names the properties the loader reads, so the builder
  refetches when one changes and says what to fill in first rather than asking with `undefined`.
- **Neither schema checks membership.** The options are not known when the kit is written, and a
  stored definition may name a channel that has since been archived. The stored schema bounds the
  length and the resolved schema takes a string; the builder says so instead, against the field.
- **`loadOptions`/`optionsResult` on the engine protocol**, and a one-shot `options-host` beside the
  run's `step-host`. Separate hosts because they want opposite things: a run keeps one child alive
  across its steps and mediates Redis-backed rate-limit tokens; this asks one question and kills it.
  A builder waiting on a dropdown is not something to queue behind a flow's quota.
- **`POST /api/v1/kits/options`**, session-guarded and tenant-scoped. A connection the workspace does
  not own is a 404, one that exists but cannot be resolved is a 400 — `resolveConnectionCredential`
  raises a step failure, which is the right shape for a run and a 500 for a request.
- **`resolveConnectionCredential` moved to `packages/auth`**, because the worker and the api now both
  need it and neither may import the other. Two copies would be two places for the tenant scoping to
  drift.
- **A searchable combobox, not a `Select`.** The cap is a thousand options; scrolling a thousand
  channels is hunting, not choosing. Built on the shadcn `Command` primitives (cmdk added) rather
  than assembled from `div`s, because the parts that get skipped by hand are the combobox roles,
  `aria-activedescendant` following the arrow keys, and Escape.
- **An option carries a `description`** — "private" — separate from its label, so the builder can
  style it as secondary, search it, and pair it with a lock icon. A channel is never told apart by a
  glyph alone.
- Slack's loader paginates `conversations.list` to the platform cap. Deliberately not one page:
  Slack's pages are not alphabetical across a workspace, so stopping after the first would hide
  channels in an order nobody could predict.

## Action required

**Existing Slack connections must be re-authorised**, and the Slack app needs two more Bot Token
Scopes: `channels:read` and `groups:read`. `conversations.list` needs them, and a connection granted
before this lands has a token that does not carry them — the picker answers `missing_scope` until it
is reconnected. The kit declares them, so `tests/registry.test.ts` now fails if the connector ever
stops requesting them.

`ENGINE_ALLOW_PRIVATE_NETWORK` is now read by the **api** as well as the worker and the two must
agree — an option loader reaches the network the same guarded way a step does, so the address rules
have to be the deployment's rather than a second, looser set. No new variable; `.env.example` says so.

## Verification

`bun run verify` — all nine gates.

Executed rather than read, because that is where this engine's bugs have always been:

- `packages/kit-runtime/tests/options-host.test.ts` spawns the **real** child and asserts a
  non-dropdown property, an unknown action and a kit's own refusal each come back as a failure rather
  than as an empty list or a hang.
- The endpoint was exercised against a running api with a real session: the catalogue serves `channel`
  as `dynamicDropdown`, and the failure paths answer 404, 400 and 400 with messages naming the cause.
  That run is what found the 500 above. The scratch account used for it was deleted afterwards.
- `packages/kits/tests/slack/channels.test.ts` covers the cursor, the empty-cursor terminator, the
  cap, and a refusal carrying Slack's own error code.
- `apps/web/tests/lib/dynamic-options.test.ts` covers the rules that break quietly — chiefly that the
  request carries only the inputs the loader reads, since it is also the query key and sending the
  whole step would refetch the channel list on every keystroke in the message field.
