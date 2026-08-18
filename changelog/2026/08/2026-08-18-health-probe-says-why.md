# A failing health check says what it saw

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `apps/api`, `apps/worker`, `packages/shared`

## Summary

Both Dockerfiles now run `packages/shared/scripts/health-probe.ts` instead of an inline
`bun --eval` fetch. A failing probe prints the response it got, so `docker inspect` — and the
service page in Coolify — shows which dependency was down instead of nothing at all.

## Why

`dependency failed to start: container api-… is unhealthy` is the whole of what a failed deploy
tells you. Docker keeps the output of the last few health commands in `State.Health.Log`, which is
the one channel that can carry a reason out of a container that never came up — and the old probe
wrote nothing to it, so the field was empty and the deploy log had nothing to add.

The API already answers `/health` with a per-dependency report and a 503. Printing it costs one
line and turns "the api is unhealthy" into "postgres up, redis down after 3002ms".

## What changed

- `packages/shared/scripts/health-probe.ts`, shared by both images: it resolves the port from the
  service's own variable (`API_PORT`, `WORKER_HEALTH_PORT`) with the default from `config.ts`,
  fetches `config.http.routes.health`, and on failure prints either the status and body or the
  connection error. The port numbers the two `HEALTHCHECK` lines used to repeat are gone.
- Nothing about *when* a container is healthy changed: same interval, timeout, start period and
  retries, same 200-or-nothing rule.

## Action required

**None.** Rebuilt images pick it up automatically.

## Verification

Ran the Coolify compose locally (`--project-directory .`, placeholder credentials):

- the api reaches `healthy` with Postgres and Redis up;
- stopping Redis turns it `unhealthy` after the usual three failures, and the health log now reads
  `health-probe: … answered 503 {"…","redis":{"status":"down","latencyMs":3002}}`;
- a container whose process exited reports `… is not answering — Unable to connect`.
