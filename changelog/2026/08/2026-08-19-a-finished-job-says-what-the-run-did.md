# A finished job says what the run did

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `worker`, `packages/shared`

## Summary

The flow-execution processor now returns a summary — `runId`, `status`, and the reason and step when there is one
— which BullMQ stores as the job's `returnValue` and the queue dashboard shows. Every job previously read as
`returnValue: null`, whatever had happened inside it.

## Why

Once the queue kept its finished jobs, the dashboard had something to list and nothing to say about it. The job
payload is a *pointer* — one `executionId` — so two jobs whose runs did completely different things were
indistinguishable.

That matters more than it looks, because of how a failure actually lands in the queue. The processor rethrows once
the journal is written, so a failed run does fail its job's first attempt — but BullMQ then retries, the retry
finds the run already settled and returns without executing anything, and the job ends up in **completed**. So a
run that failed and a run that succeeded both appear in the same set. The summary is what tells them apart.

The obvious next suggestion was to put the step inputs and outputs in the job as well, and that is worth declining
explicitly rather than leaving as an open question:

1. **Redis is not the record.** `flow_runs.trigger_payload` and `flow_step_runs.input/output/error` already hold
   all of it, per step. A second copy can disagree with the first, and the Redis copy is the one that *expires*
   under the queue's retention.
2. **The dashboard is one cross-tenant operator password.** Today that credential exposes identifiers. Carrying
   payloads would make it a cross-tenant browser of customer data — addresses and message bodies, every workspace.
3. **Size, in memory.** An `http.request` step may return megabytes. That would become Redis, times the retained
   job count.
4. **Outputs do not exist when the job is enqueued.** They are produced during execution, so the return value is
   the only place they *could* go.
5. **Re-publish safety.** The relay publishes then marks published; a crash between the two re-publishes, and
   BullMQ deduplicates on `jobId`. A small fixed payload makes "the same job" trivially true.

So the summary carries `runId` as the pointer back to the copy that is authoritative, and nothing else that would
duplicate it.

## What changed

- **`packages/shared/src/queue.ts`** — `FlowExecutionResult`. `status` is `succeeded | failed | skipped`, and
  `skipped` earns its place: a run that is gone, already settled, or claimed by another worker is an ordinary
  outcome of an idempotent queue, and a dashboard that cannot distinguish those from a successful execution
  misleads.
- **`apps/worker/src/processor.ts`** — every exit path returns a summary rather than falling out of the function.
  There are seven, and each previously looked identical from the queue: run missing, run not pending, claimed
  elsewhere, definition no longer valid, a step with no connection, a credential that would not resolve, and the
  execution itself.
- **`packages/shared/src/config.ts`** — the retention comment corrected. It claimed a failed run's job completes
  "because the worker records the outcome and returns normally", which is the wrong mechanism: it throws, and the
  *retry* completes. The correction matters because it is the difference between "the queue never sees failures"
  and "the queue sees them once, then overwrites the verdict".

## Action required

**Restart the worker** for it to take effect. No environment variable, no migration, no API change.

Existing retained jobs keep their `returnValue: null` — nothing rewrites a finished job, and they will age out
under the 250/500 retention.

## Verification

`bun run verify` — all nine gates, 561 unit tests.

- **Driven through the real processor against the live database**, on the two paths that have no side effects:
  a run id that does not exist returns
  `{"runId":"…","status":"skipped","reason":"the run no longer exists"}`, and a settled run returns
  `{"runId":"…","status":"skipped","reason":"the run is already succeeded"}`. Both are what BullMQ stores verbatim.
- **The mechanism above was checked against the live queue** rather than assumed: the newest completed job carries
  `attemptsMade: 1` and no `failedReason`, and the failed set is empty — consistent with successful runs
  completing first try, and with failures having been laundered into completions by their retry.
