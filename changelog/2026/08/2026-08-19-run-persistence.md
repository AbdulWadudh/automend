# Runs, the step journal, and the outbox

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/db`, `packages/shared`, `scripts/verify`

## Summary

Five new tables and the queries over them: `flow_runs`, `flow_step_runs`, `flow_run_outbox`, `kit_stores`
and `flow_trigger_registrations`. Plus `packages/shared/src/runs.ts`, which holds the status vocabulary and
the state machine every transition goes through.

This is the layer that makes the engine's promises keepable. Nothing executes yet — the engine is next —
but every guarantee it will rely on is here and tested against a real Postgres.

## Why

**A retried trigger must produce one run, and a retried job must not repeat a step's side effect.** Those
are two of the platform's non-negotiables, and both are decided *inside the database*:

- `flow_runs` has a unique index on `(flow_id, idempotency_key)`. A sender retrying a webhook, a poll
  returning an item it already returned, somebody double-clicking Run — each resolves to the row that
  exists. `xmax = 0` in the `RETURNING` clause is what tells an insert from a conflict in one statement,
  the same trick `recordWebhookDelivery` already uses.
- `flow_step_runs` has a unique index on `(run_id, step_id, attempt)`, and `claimStepRun` does
  `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Either the caller inserted the row and owns the right to
  invoke the action, or somebody else did and **the recorded result is authoritative** — which is the only
  reason a third attempt at a flow does not send a third email.

A read-then-write in application code cannot do either job: it races with exactly the concurrent retry it
exists to stop. Two deliveries arriving two milliseconds apart would both find nothing and both insert.

**The key is derived from what happened, not generated when it is noticed.** `buildRunIdempotencyKey`
takes the external identity — the delivery's `Idempotency-Key`, the polled item's id — and prefixes it with
the source, because a webhook delivery and a polled item could otherwise collide on a bare upstream id.

**The unique index is on the attempt, not the step.** A retry gets a new row rather than overwriting the
old one, because discarding the record of a failed attempt discards the only evidence of what went wrong.

**A claim is recorded before the action runs.** A subprocess killed mid-send therefore leaves a `running`
row with no result — which is the honest state, because "we do not know whether this happened" is exactly
the truth. That is also why a retry takes a fresh attempt number instead of assuming the previous one did
nothing.

**`definition_snapshot` freezes the flow as it was.** Without it, editing a flow would rewrite the history
of every run in flight: a run would finish against steps it never began with, and a retry an hour later
would execute something nobody had reviewed.

**The outbox is the third non-negotiable.** Enqueueing a BullMQ job as a side effect of a Postgres write
gives you a job for a run that does not exist whenever the transaction rolls back; writing only the run
gives you a run nobody executes. So `createFlowRunWithOutbox` writes both in one transaction, and the
relay publishes. The outbox row is written **only for a genuinely new run**, which is what stops a
replayed delivery from queueing a second execution.

This also makes the webhook receiver honest. It has been answering `202` — "stored, and it will run" — for
runs that could never happen, because there was nothing to carry the intent across.

**`FOR UPDATE SKIP LOCKED` is what lets more than one worker relay.** Without it a second relay blocks
behind the first, turning horizontal scaling into a serial queue.

**`kit_stores` scopes by primary key rather than by convention.** The key *is* `(tenant, flow, trigger,
key)`, so a kit cannot construct a key that reaches another workspace's data. Tenant isolation there is
structural instead of something every kit author has to remember.

**`flow_trigger_registrations` exists before the scheduler does.** Nothing fires from a schedule yet, but
the row has to be written when a flow is saved: a polling cursor seeded by `onEnable` with no registration
to own it is orphaned state that nothing can find, clear, or explain.

## What changed

- **`packages/shared/src/runs.ts`** — status vocabularies, the run and step response schemas, and
  `canTransitionRun`/`canTransitionStep`. The transition tables are written out explicitly rather than as a
  rule, because the interesting cases are the ones that are *absent*: nothing leads out of a terminal
  state, nothing reaches `succeeded` except by running, and a step may be `skipped` before it starts but
  never after — a step that has acted on the world cannot be un-acted.
- **The state machine is enforced in SQL as well as in TypeScript.** `finishFlowRun` and `completeStepRun`
  carry `status = 'running'` in their predicates, so a late result from a subprocess that was already
  killed cannot mark a timed-out run as succeeded.
- **`config.runs`** — statuses, terminal sets, sources and the BullMQ retry policy. `attempts: 3` is only
  safe *because* of the step journal; without it this would have to be 1. `config.runs.sources` is derived
  from the same constant as `config.kits.triggerStrategies`, since a run's source is the strategy that
  produced it and writing the list twice would let a run exist whose source no trigger could have caused.
- **`config.outbox`** — its own domain rather than a member of `config.queue`, because everything in there
  is a queue and `tests/config.test.ts` asserts as much. The outbox is what *feeds* a queue.
- **Migration `0006_red_vindicator.sql`.** The existing migration-replay gate needed no changes: it seeds
  every table by introspecting `information_schema`, so it picked up all five automatically.

## Action required

**Run `bun run db:migrate`.** Five new tables; no existing table or column changes, so the migration
applies cleanly to a populated database.

No new environment variables — `config.runs` and `config.outbox` are application constants, and
`.env.example` is unchanged.

## Verification

**`packages/db/tests/runs.test.ts` runs against a real Postgres — 23 tests.** Mocking Drizzle here would
assert that the code calls the functions it calls, which is worth nothing: the entire question is what the
database does when two callers arrive together. So the tests fire callers *concurrently* rather than in
sequence, which is the only version that proves anything:

- Five simultaneous `createFlowRunWithOutbox` calls with one key produce one run, exactly one caller
  believing it created it, and one outbox row.
- Five simultaneous `claimStepRun` calls on one attempt grant exactly one claim; the other four are told
  the result already exists.
- A completed step reports its stored output instead of being claimed again — the replay that stops the
  second email.
- Two relays claiming concurrently never take the same row twice.
- A finished run cannot be finished again; a run that never started cannot be marked succeeded; a failed
  step's output is not offered for replay.

**A new verify gate makes those tests actually run.** They skip themselves when `DATABASE_URL` is unset,
which keeps `bun test` usable with no infrastructure — but a test that silently skips in CI is a test
nobody is running, and CI has no database. `scripts/verify/database-tests.ts` starts a throwaway Postgres,
applies the migrations, runs them, and **fails if they were skipped rather than passed**, since a skipped
suite exits 0 and would otherwise turn the gate green having proven nothing. The image and credentials come
from `config.localDev.postgres`, so the Postgres major version cannot drift from the one deployed against —
which is why it is a script rather than a `services:` block the workflow could not derive.

Confirmed by hand: an explicitly-passed `DATABASE_URL` beats Bun's auto-loaded `.env`, so the gate really
uses its own container; and with no database the suite reports `0 pass / 25 skip`, which both guards catch.

`bun test` — 360 across the repo. `bun run typecheck` (8 packages), `bun run check` and
`bun run config:check` clean. `packages/db/tsconfig.json` now includes `tests/`, which it did not before —
those files were never being type-checked.
