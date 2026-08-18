# Every variable the builder offers is one the engine can resolve

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`, `worker`, `packages/shared`

## Summary

The variable picker inserted `{{email}}` while the engine resolves `{{trigger.body.email}}`, so every chip
the builder produced was unresolvable. The literal then travelled to whatever the step talked to. Three
changes: the picker prefixes its paths, an unresolved variable now stops the step instead of being sent
onward, and the queue keeps finished jobs so a run can be inspected or re-run.

## Why

A Gmail step failed with `Gmail refused to send the message (HTTP 400) — Invalid To header`, and on a later
attempt with `The socket connection was closed unexpectedly` — the same malformed request rejected two
different ways. The step's `to` was `{{email}}`, taken from the builder's own picker.

Nothing about the address was hardcoded, and that is worth being clear about because it looked like it.
`resolvePath` walks an arbitrary path through whatever arrived, so any shape works — `{{trigger.body.order.ref}}`
resolves if the payload has one. The problem was purely the **root**:

- the engine resolves against `{ trigger, steps }` ([`buildResolutionContext`](../../../apps/worker/src/engine/resolve-input.ts)),
  so a webhook's JSON body sits at `trigger.body`;
- the builder called `listSampleVariables(JSON.parse(delivery.body))` — the **body alone** — so it emitted
  `email`, `name`, `message`, `from`.

Each half was self-consistent, which is exactly why no test caught it. Asserting specific paths on either
side would have passed. Only round-tripping the two together fails.

The second problem is what happened next. `resolveStepInput` collected unresolved variables and carried on,
on the stated reasoning that "a step that genuinely needed it fails its own required check a moment later".
That is not true, and it is the whole of how a bad configuration reached Google: `"{{email}}"` is a
*non-empty string*, so the required check passes and the literal is handed to the kit. There is no reading
under which `{{email}}` is a value somebody meant to transmit.

The third is why none of this was visible in the queue dashboard. `removeOnComplete: true` deleted every
successful job the instant it finished, so a run that had plainly executed left nothing behind, and
`removeOnFail: false` kept failures forever, which never reclaims.

## What changed

- **`packages/shared/src/templates.ts`** — `listSampleVariables(sample, prefix?)`. The prefix is applied to
  `path` only: `label` stays relative, because it names the field for somebody reading a menu rather than
  describing where the value lives. It is also applied *after* the walk, so it costs nothing against
  `maxSampleDepth` — a deeply nested field must not drop out of the menu because of where the payload sits.
- **`packages/shared/src/config.ts`** — `flows.templates.triggerVariablePrefix` and `stepsVariablePrefix`.
  Shared because the builder *writes* these paths and the engine *resolves* them; the two silently
  disagreeing is the bug.
- **`apps/web/src/routes/app/flows/$flowId.tsx`** — passes the **whole** delivery (`body`, `method`, `path`,
  `query`, `headers`) under the `trigger` prefix. So `{{trigger.method}}` and the headers are now offered
  too — the engine always resolved them, only the picker never said so. `body` is listed first because that
  is what anybody is looking for and the picker keeps insertion order. A body that is not JSON no longer
  empties the whole menu: the request's own metadata is still offered.
- **`apps/worker/src/engine/resolve-input.ts`** — an unresolved variable is now a resolution failure naming
  every missing path at once, not just the first. The executor already refuses a failed resolution *before*
  the subprocess is involved, so nothing reaches the outside world. `ResolvedInput.unresolved` is gone,
  along with the executor's warning that read it — both are dead once the case is fatal. A step that should
  tolerate it can still set `continueOnFailure`.
- **`packages/shared/src/config.ts`** and **`apps/worker/src/outbox-relay.ts`** — the queue keeps the last
  **250 completed** and **500 failed** jobs (`removeOnComplete: { count }`, `removeOnFail: { count }`).
  Bounded by count because Redis holds this and unbounded history is a slow leak; more failures than
  successes because a completed job is history while a failed one is work somebody may still want to read or
  re-run, and it has to outlive the successes accumulating around it.

### One thing retention does *not* fix

A failed run mostly does not appear in the **failed** set, and the mechanism is worth stating precisely because
the obvious guess is wrong. The processor *does* rethrow once the journal is written, so the job's first attempt
fails. BullMQ then retries; the retry finds the run already settled and returns without executing anything; the
job ends up **completed**. So the failed set holds only a run still mid-retry or one that died outside a step.

The queue therefore cannot be read as the record of what succeeded — `flow_runs` and `flow_step_runs` are that.
A follow-up change adds a `returnValue` summary so the queue's own view says which of the two happened.

## Action required

**None** — no environment variable, no migration, no API change.

Two behavioural changes to be aware of:

- **A flow whose fields reference data the trigger does not send now fails instead of running.** That is the
  intended change, and the failure names the variables. Any flow configured through the picker before this
  fix holds unresolvable paths and will now fail *clearly* rather than sending `{{email}}` onward — reopen it
  and re-insert the variables, which will now carry the `trigger.` root.
- **Restart the worker** to pick this up. `bun --hot` cannot help here: the BullMQ `Worker` is constructed
  once at startup, so the already-registered handler keeps the closure it was built with.

## Verification

`bun run verify` — all nine gates. 538 unit tests pass, 17 of them new.

Run rather than reasoned about:

- **The picker, against the payload that caused the incident.** Every path it now offers resolves, and to the
  right value: `{{trigger.body.email}}` → `abdulwadudh5@gmail.com`, `{{trigger.body.name}}` → `Lynda Huels`,
  plus `{{trigger.method}}` and `{{trigger.headers.content-type}}`. Before the fix all four body paths
  reported unresolved.
- **The invariant test** in `packages/shared/tests/templates.test.ts` asserts that nothing the picker offers is
  unresolvable, so it fails if the prefix is ever dropped again.
  `apps/worker/tests/engine/resolve-input.test.ts` pins the other half — that the configured prefix is the key
  the engine actually builds the context under.
- **Retention, against a real Redis.** A throwaway queue with the relay's exact options processed six jobs
  (three succeeding, three failing) and both sets survived: `completed: 3, failed: 3`. Under
  `removeOnComplete: true` the completed count would have been `0`, which is what the empty dashboard was.
- **The diagnosis itself came from the data**, not from reading: `flow_step_runs` showed the recorded input
  still holding the literal `{{email}}` on both attempts, which is what ruled out the credential path and
  pointed at substitution.
