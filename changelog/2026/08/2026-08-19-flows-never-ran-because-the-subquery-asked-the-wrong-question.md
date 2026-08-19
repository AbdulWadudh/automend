# Flows all reported "never run"

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `packages/db`

## Summary

`listFlowsForTenant`'s `lastRunAt` was null for every flow, including ones with hundreds of runs.
Two defects, one behind the other: the correlated subquery compared the wrong columns, and the value
it returns is a string where the type said `Date`.

## Why

**The comparison.** The subquery was written as:

```ts
sql`(select max(${flowRuns.createdAt}) from ${flowRuns} where ${flowRuns.flowId} = ${flows.id})`
```

Drizzle renders a column inside a select-list expression **unqualified**, so that became
`where "flow_id" = "id"` — and inside the subquery both names resolve to `flow_runs`, because the
inner table shadows the outer one. It asked whether a run's flow id equalled its own id, which is
never true, so `max()` returned null for every row. The same SQL written by hand with table aliases
returns the right answer, which is why this looked like a UI bug.

**The type.** With the comparison fixed the value came back as `"2026-08-19 02:39:52.783267+00"` —
a string. A raw `sql` expression has no column for the driver's mapper to consult, so the timestamp
arrives exactly as Postgres wrote it. `FlowListRow` declared `Date | null`, and the API calls
`.toISOString()` on it: fixing only the comparison would have turned "never run" into a 500.

## What changed

- The subquery aliases the inner table and qualifies the outer reference:
  `select max(runs.created_at) from flow_runs as runs where runs.flow_id = "flows".id`. This is the
  same trap `run-activity.ts` already documents for `retryColumns`, seen from the other side — there
  it was one table twice, here it is the outer table losing its qualifier.
- `lastRunAtColumn` is typed `string | null`, which is what it is, and `listFlowsForTenant` converts
  to a `Date` so callers get what `FlowListRow` promises.
- **A regression test for the populated case.** The existing test only asserted that a flow which has
  never run reports no last run — which a query returning null for everything passes perfectly. That
  is why this shipped. The new test creates a run, asserts `lastRunAt` is a `Date` within a second of
  the insert, and asserts the *other* flows still report null, so a fix that populates every row fails
  too.

## Action required

**None.** No schema change; the query was always wrong at read time.

## Verification

`bun test packages/db/tests/flows.test.ts` against the compose Postgres (8 pass), plus the failing
case reproduced first: the new test fails on the old query, and fails differently on the fixed query
before the string-to-`Date` conversion.
