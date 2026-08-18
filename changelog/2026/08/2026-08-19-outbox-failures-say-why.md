# A stuck run can now say why, and be given another chance

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `worker`, `packages/db`

## Summary

Two holes in the outbox relay, found by looking at the dev database after the engine landed rather than by reading
the code: a publish failure could record no reason, and a row that gave up had no way back.

## Why

**The dev database held two rows at their attempt limit with `last_error` null.** That is the exact state the column
exists to prevent — a run that exists, looks queued, and will never execute, with nothing to explain it. The
relay's own comment claims it prevents that, so the code was contradicting its own documentation.

Two ways to reach it, and both are ordinary:

1. **`(error as Error).message` on something that is not an `Error`.** A `catch` receives whatever was thrown — a
   rejected `fetch`, a library throwing a string, a `null` — and reading `.message` off those gives `undefined`,
   which stores as null. The cast made this look safe.
2. **A throw escaping the per-entry loop.** `claimOutboxBatch` spends an attempt on *every* row in the batch before
   any of them is published, so one unexpected throw abandoned the rest with an attempt spent and no reason
   recorded.

**And a stuck row was stuck for good.** The relay logged "needs attention" and offered nothing to do about it: the
only remedy was hand-written SQL against production. An alert with no remedy is not much better than no alert.

## What changed

- `markOutboxFailed` **refuses an empty reason** and writes a placeholder instead. A useless message beats a null,
  because the null is the state that cannot be diagnosed.
- `describeFailure` replaces `(error as Error).message` — it handles a non-`Error`, an `Error` with an empty
  message, and the `[object Object]` case that `String()` produces for a thrown plain object.
- Each entry in a batch is **isolated**, so one unexpected throw records its own reason and the rest of the batch
  still gets its chance.
- **`resetStuckOutboxRows`** gives exhausted rows a full attempt budget again, keeping `last_error` — what failed
  last time is the most useful thing to know if it fails again. The relay's log names it, so the alert says what to
  do.

## Action required

**None.** No schema change, no new variables.

If a deployment has stuck rows, read `last_error` on `flow_run_outbox` and then call `resetStuckOutboxRows`; the
relay's log message now says so.

## Verification

Three new tests in `packages/db/tests/runs.test.ts`, against a real Postgres: an empty reason still records
something, and a stuck row can be revived, keeps its `last_error`, and is claimable again afterwards.

Then confirmed against the real stack. The two stuck rows in the dev database were revived, the worker was started,
and the log shows the whole pipeline in order — `queued runs from the outbox` → `executing flow` →
`flow finished` → `job completed` — with the run recorded `succeeded`. Its step journal is empty because that flow
has no steps, which is the right answer rather than a missing one.
