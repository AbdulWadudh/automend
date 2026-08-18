# The run dashboard

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `apps/web`, `apps/api`, `packages/db`, `packages/shared`

## Summary

A `Runs` section that shows what every flow received, what it did next and how it ended — a summary
over a chosen window, an activity feed across flows, and a per-run timeline. A finished run can be
started again with the data it originally received. The feed filters by flow through a picker that
searches the API as you type, and by run id straight to the run.

## Why

The step journal has recorded all of this since run persistence landed, and nothing could read it.
A flow that failed at 3am left a `flow_step_runs` row explaining exactly why, reachable only with a
SQL client — which is not a feature, it is a table.

Three decisions in here are worth knowing about, because each one had a plausible alternative:

**A retrigger is a new run, not a reopened one.** The failed run's journal is the evidence of what
broke; marking it `running` again would destroy the only record of the failure somebody is in the
middle of investigating. The new run points at the old one through `retry_of_run_id`.

**A retrigger executes the flow as it is now, not the snapshot that failed.** People retrigger
because they have just fixed the thing that broke — replaying the definition that failed would
reliably fail the same way. The new run takes its own snapshot, exactly as any other run does.

**A failure says whether it has been dealt with.** `retry_of_run_id` points from a retry back to its
source, which means the *source* knows nothing — so a failure somebody already fixed looks exactly
like one nobody has touched, and the obvious behaviour is to retry it again, and again. Every run now
carries the reverse view: how many runs were started from it and how the newest one ended. The feed
badges it, and `Run again` is disabled while a retry is still going and asks first once one has
succeeded, so retries cannot silently stack up on the same failure.

**The idempotency key comes from the client.** The first attempt derived it from the source run and
a count of retriggers already made, on the theory that two clicks would count the same predecessors
and collapse. The concurrency test disproved it: with five simultaneous callers, some count reads
land after the first insert commits, and two runs are created. The server cannot tell an accidental
double-submit from a deliberate second retrigger — the requests are identical — so the caller names
its own gesture and rotates the token after a success. `RetriggerButton` holds it in a ref.

## What changed

- **`flow_runs.retry_of_run_id`** — self-referential, `set null` on delete, with an index the
  lineage badge reads. Plus `flow_runs_tenant_created_idx`, which is what the feed scans.
- **`packages/shared/src/run-activity.ts`** — the feed and summary schemas, and `summariseRunGroups`,
  which pivots per-`(flow, status)` groups into the summary. Averages are weighted by finished-run
  count, which is why the query returns a sum and a count rather than an average it cannot recombine.
- **`packages/shared/src/runs.ts`** — `runDurationMs` and `formatDurationMs`. No response carries a
  duration: it is `finishedAt - startedAt`, and sending it too would let the two disagree.
- **`packages/db/src/run-activity.ts`** — `listRunsForTenant` (keyset cursor on `(created_at, id)`,
  so runs arriving mid-read cannot make the next page skip one), `summariseRunsForTenant`,
  `findRunWithFlowForTenant`, `retriggerRun`.
- **`apps/api/src/routes/runs.ts`** — `GET /api/v1/runs`, `/runs/stats`, `/runs/:id`, and
  `POST /runs/:id/retrigger`. A run that has not finished cannot be retriggered: it may still be
  mid-send, and the step journal protects a retry of the *same* run, not a second one.
- **`apps/api/src/http/run-responses.ts`** and **`definition-validation.ts`** — extracted from
  `routes/flows.ts`, which had the only copies. Both routers now describe a run identically.
- **`apps/web/src/routes/app/runs/`** — the dashboard and the timeline page, plus `components/runs/`.
  Both poll only while something on screen is unfinished; a terminal run never changes again.
- **`GET /api/v1/flows?search=&limit=`** — `listFlowsForTenant` takes a search term and a bound. The
  term is `ilike`-escaped, so a flow named `100% uptime` is findable and does not become a wildcard.
  `limit` has no default: absent still means every flow, which is what the flows page has always
  asked for, and only the picker sends one.
- **`components/runs/flow-picker.tsx`** — a combobox over that endpoint, debounced, with the standard
  `aria-activedescendant` arrangement: focus stays in the input, and the options are options.
- **`components/runs/run-id-search.tsx`** — pastes a run id (or a URL containing one) and opens it.
- **`components/runs/copyable-id.tsx`** — the run and flow ids on the timeline page and the run id on
  every activity row, each with the copy control inside the field rather than beside it. It sits
  outside the row's link, because a button inside an anchor is not a thing. Rows show only the uuid's
  trailing group: a full one gets clipped at that width, and a clipped id is worse than a
  deliberately short one. Copying still yields the whole value.
- **`components/ui/alert-dialog.tsx`** — new, and used for one thing: running a run again asks first
  when that would repeat work which already came off — this run succeeded, or a run started from it
  did. An unfixed failure has nothing to repeat, so the common case goes straight through.
- **`components/runs/retry-badge.tsx`** and the `retries` field on every run — `{ count, latestRunId,
  latestStatus }`, from three correlated subqueries over `flow_runs` aliased to itself. The alias is
  written out rather than interpolated: Drizzle renders an `alias()` as the alias alone, with no base
  table, which is a subquery that does not run.
- **`apps/web/src/lib/format-time.ts`** — one clock format across the dashboard, `Aug 19, 2026 4:53 AM`,
  pinned to `en-US` because the shape was chosen rather than inherited. Timeline entries keep seconds.
- **`CLAUDE.md`** — the comment rule is stricter, and says so concretely: no file-header essays, no
  doc block per export, one reason in one sentence.

## Action required

**A migration** — `0007_yellow_supernaut.sql`. Applied by the `migrate` service on deploy; nothing
to run by hand.

## Verification

- `bun test` — 603 pass. New: `packages/shared/tests/run-activity.test.ts` (the summary pivot, the
  weighted average, unknown statuses), the duration and retrigger-key cases in
  `packages/shared/tests/runs.test.ts`, and `packages/db/tests/run-activity.test.ts` against a real
  Postgres — five simultaneous submits of one press produce one run and one outbox row, a second
  press produces a new run, paging past a cursor neither repeats nor skips, and a cursor from
  another workspace reveals nothing.
  `packages/db/tests/flows.test.ts` covers the search: case-insensitive, substring, and `%` and `_`
  treated as characters rather than as wildcards.
- The database fixtures now build their definition with `createDefaultFlowDefinition()`. A
  hand-written stub is a row `listFlowsForTenant` cannot read back, because every flow read is
  upgraded on the way out.
- `packages/db/tests/runs.test.ts` claims the outbox with a limit larger than anything the tests
  write. `claimOutboxBatch` is global by design — it is the relay — so with the production batch size
  the rows left by earlier tests can crowd out the row a test just wrote, which surfaced as an empty
  id rather than as the volume problem it was.
- One bug found by running it rather than reading it: `/runs/stats` answered 500 because a raw `sql`
  `max(created_at)` comes back as a **string**. Drizzle's driver turns off node-postgres' timestamp
  parsers and maps them per column, which a raw expression has no column to consult — so
  `.toISOString()` threw. It now uses Drizzle's own `max()`, and `lastRunAt` is nullable end to end
  because an aggregate's type says it can be. The summary test asserted counts and durations but
  never that column, which is how it got through; it does now.
- `bun run typecheck`, `bun run check`, `bun run verify`.
