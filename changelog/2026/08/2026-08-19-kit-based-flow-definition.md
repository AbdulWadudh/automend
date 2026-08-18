# Flow definition v2: a step is a kit and an action

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/shared`, `packages/kits`, `packages/db`, `api`, `web`

## Summary

A step no longer names one of four hardcoded kinds. It names a kit, an action, and an opaque `input` — so what a
step can do is the registry rather than a union in `flow-definition.ts`. The builder renders its forms from the
kit catalogue, served over HTTP at `GET /api/v1/kits`.

The webhook route now creates runs, which makes its `202` true for the first time. `POST /flows/:id/runs` starts
one by hand, and `GET /flows/:id/runs` and `/runs/:runId` read the history and the step journal.

Still nothing executes those runs — that is the engine, next.

## Why

**This is the change everything else was for.** Adding Slack used to mean editing the shared schema, the
builder's config factory, a label map, an icon map, an accent map and the inspector's `switch`. Now it means
adding a directory under `packages/kits/src/` and one line in the registry. Nothing in `apps/web` knows that
Gmail exists.

**Validation had to split in two, and the split is forced rather than chosen.** `@automend/shared` promises to
depend on nothing and the browser imports it, so `flowDefinitionSchema` cannot reach the registry — and a schema
that could would drag every kit's code into the bundle. So:

- **shared** checks structure: node ids, the graph rules (cycles, dangling edges, nothing into the trigger), that
  a kit id is camelCase, that `input` is a record.
- **kits** checks meaning: `validateDefinitionAgainstRegistry` resolves the kit and action and validates `input`
  against the property map they were declared with.

The API calls both on save. The engine will call both again before a run, and that is *not* redundant: a run
executes a snapshot taken when it began, and a kit may have changed between the save and a retry an hour later.

**`findStepsMissingConnections` is deliberately separate, because the answer is allowed to be no.** A flow saved
before its Google account is connected is a normal state to be in — the builder shows it as unfinished. A run
that *reaches* such a step has to fail. Folding the two together would mean either refusing to save work in
progress or letting a run start that cannot finish.

**The upgrade consults the registry, which was not the original plan.** The mapping itself is pure data — a v1
kind becomes a fixed kit-and-action pair whether that kit is still installed or not, because silently dropping a
step whose kit had gone would lose an author's work without telling them. But the *values* need the property
declarations, and a test found out why: v1 stored a duration as the number `1000`, and a v2 templatable field is
**text** at rest, because a field that may hold `{{retryAfterMs}}` cannot be a number. Left as a number the
upgraded flow failed its own stored schema. Only the declarations know which fields those are; the alternative
was four hardcoded field lists that would go stale.

**A cleared field removes its key rather than storing `""`.** The engine treats blank as absent, so storing the
empty string would let a required field pass validation on save and fail at run time for a reason the builder
never showed.

**`continueOnFailure` is the only error-handling switch, because it is the only one the executor will honour.** A
`retryOnFailure` flag would read as a feature and do nothing — BullMQ retries the whole run, and per-step retry
does not exist.

**A number field is a text field.** `type="number"` would let the browser refuse `{{orderCount}}` — the very
syntax that makes a flow useful. The engine coerces the resolved value, so nothing is lost by accepting text and
stating the accepted range in the hint instead.

**Unavailable options are shown disabled with a reason, never hidden.** An author who knows the platform supports
Gmail should be able to find out *why* they cannot use it. Two different reasons, needing two different fixes: no
credentials for the service, or no scheduler for that kind of trigger yet.

## What changed

- **`flow-definition.ts` v2.** `{ kitId, actionName, input, connectionId?, continueOnFailure }` for a step;
  `{ kitId, triggerName, input, connectionId? }` for the trigger. `readTriggerText` is the narrow, total way to
  read the two trigger values that are *addresses* rather than data — a webhook path and a cron expression — which
  the API must route on before any kit is involved.
- **`config.kits.namePattern` is shared** between `kit-framework` (which checks a kit as it is declared) and
  `flow-definition` (which checks a step read back out of a `jsonb` column). A second copy of the pattern is how a
  stored flow comes to name something no kit could be.
- **`upgradeFlowDefinition` runs on read in `packages/db/src/flows.ts`**, so "a flow read from the database has a
  current definition" holds in one place. Rows are not rewritten on read — the upgrade is in memory and persists
  on the next save, so reading never needs a write transaction. `findFlowForWebhook` upgrades too: matching a path
  against a v1 shape while the engine runs a v2 one is how a flow comes to accept a request it cannot run.
- **`GET /api/v1/kits`** serves the catalogue, session-guarded. `available` reflects which connectors this
  deployment has configured, which is a fact about the installation.
- **Runs are startable and readable**: `POST /flows/:id/runs` (`202` and a run id, `200` if the idempotency key
  was seen before), `GET /flows/:id/runs`, `GET /flows/:id/runs/:runId` with its step journal. The run detail
  route matches on flow id as well as tenant, so one flow's history cannot be read through another's address.
- **`hooks.ts` records the delivery, creates the run and queues the intent in one transaction.** The trigger
  payload is the delivery as it arrived — method, path, query, headers, body — because a sender's headers are
  often the interesting part and a body is not always JSON. `body` is parsed when the request declared JSON and
  the raw text when it did not, so a template can reach into one without the other becoming unreadable.
- **Every flow save registers its trigger** in `flow_trigger_registrations`, with `enabled` following what this
  deployment can actually fire — so a polling trigger is registered but switched off until the scheduler exists.
- **`components/flows/property-field.tsx`** is the new generic renderer: label above, helper text below, error
  beside the field it belongs to and connected with `aria-describedby` and `role="alert"`, Radix `Select` rather
  than a native `<select>` (whose option list the OS draws in *its* colours, which is where the unreadable
  dropdown came from), and a message alongside every red ring.
- **`TemplateField` gained `aria-describedby`, `aria-invalid`, `maxLength` and `className`.** The length bound
  refuses the change rather than truncating: quietly dropping the end of a pasted value is worse than the paste
  appearing not to take, because the author would not know which half they now have.
- **The catalogue carries `maxLength`, `minimum` and `maximum`** — added when the renderer needed them, since a
  bound the browser cannot see is a bound enforced only by a failed save.
- **`flow-kinds.ts` is keyed by kit id with a fallback**, so a kit added tomorrow renders correctly without that
  file being touched. Labels and descriptions now come from the catalogue: they are the kit author's words, and a
  second copy in the browser is how the picker comes to disagree with the engine.
- **The step palette is a menu rather than a row of buttons.** Four hardcoded kinds fitted in a row; a catalogue
  does not, and would stop fitting on the first narrow screen.
- All four states of the catalogue fetch are handled in the inspector — loading (skeletons in the shape of the
  form, so the panel does not jump), error (with a retry), empty, and populated. Three of them are reachable in
  normal use.

## Action required

**None.** Existing flows are upgraded on read — no migration of its own, no environment variables, no manual
editing. The previous change's migration is applied by the `migrate` service on deploy.

**Breaking for API clients that post definitions directly.** A v1 definition is rejected by
`flowDefinitionSchema` on the way *in* — the upgrade applies to reading stored rows, not to accepting new ones.
Anything scripted against `POST /flows` or `PATCH /flows/:id` needs the new step shape.

## Verification

`bun test` — 399 across the repo. New: `packages/kits/tests/upgrade-definition.test.ts` (every v1 kind's mapping
asserted individually, plus the number-to-text retype and its round trip back to `1000` through the resolved
schema) and `tests/validate-definition.test.ts` (unknown kit versus unknown action reported differently, all
problems at once, connections reported separately from validity).

Checked by hand against the running stack, which is where the four pieces were confirmed to line up:

- **The 6 v1 flows already in the dev database all read cleanly at v2**, validating against the registry. They
  are simple manual-trigger flows with no steps, so the step mapping's only coverage is the fixture test — worth
  knowing rather than implying otherwise.
- **A real webhook delivery creates a run.** `POST` to a flow's hook URL returned `202` with a run id; the run
  row was `pending` with source `webhook`, its definition snapshot intact, and its trigger payload carrying both
  the parsed body (`body.orderId`) and the request metadata. Replaying the same `Idempotency-Key` returned `200`,
  resolved to the same run, and added no second run and no second queued job.
- A wrong path and an unknown flow both return `404` with the same message, so a flow id cannot be used to map
  out how a workspace is configured.
- The catalogue serialises with no functions in it and carries the field metadata the renderer needs, including
  the length bounds.

`bun run typecheck` (8 packages), `bun run check` and `bun run config:check` clean.
