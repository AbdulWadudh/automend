# A real inbound endpoint for webhook triggers

- **Date:** 2026-08-16
- **Type:** feat
- **Scope:** `packages/shared`, `packages/db`, `api`, `web`

## Summary

A flow whose trigger is a webhook now has an address that exists: `/api/v1/hooks/<flowId>/<path>`,
accepting every HTTP method. The builder shows the full URL with a copy button instead of asking
for a path and doing nothing with it. Each delivery is recorded before it is acknowledged.

## Why

**The address is built from the flow's id, not chosen.** Two flows can both use the path
`incoming` without colliding, nobody has to invent a unique one, and — because the id is a UUID —
the URL is unguessable. That last part is load-bearing: this is the only unauthenticated route in
the versioned API, because the caller is somebody else's server with no session and never will
have one. The URL *is* the credential, which is why the builder says so next to it.

**Every method, because a receiver does not choose what a sender sends.** A service that delivers
with `PUT` is not a misconfiguration to reject; what the flow does with it is the flow's business.

**A delivery is stored before it is acknowledged.** The execution engine does not exist yet, so
the tempting shape was to answer `202` and drop the request — which is a lie discovered months
later, when someone asks why an event never ran. Instead every delivery lands in
`flow_webhook_deliveries` with `processed_at` null, which is both an honest state and exactly what
the engine will drain.

**Retries collapse.** Senders retry; a retry that produced a second row would become a second run
of the flow — a second charge, a second email. A unique key on `(flow, idempotency key)` decides
that in the database rather than in application logic, using the sender's own `Idempotency-Key`
when it offers one. A repeat answers `200` rather than `202`, so the sender is told it was already
accepted rather than being led to expect another run.

## What changed

- **`/api/v1/hooks/:flowId/:path`** — unauthenticated, all methods, mounted outside the session
  middleware. Unknown flow, wrong path and a flow that is not webhook-triggered all answer the same
  404 with the same message: distinguishing them would let anyone holding a flow id map out how a
  workspace is configured.
- **`flow_webhook_deliveries`** — method, path, query, headers, body, and the tenant read *from the
  flow* rather than from the request. Sensitive headers (`authorization`, `x-api-key`, cookies) are
  dropped before the row is written: a delivery log is not a place to keep other people's
  credentials. Bodies over 1 MB are refused rather than stored, since this is an unauthenticated
  endpoint that writes to the database.
- **`findFlowForWebhook`** is the one query in the codebase that reads a tenant-owned table without
  a tenant, and says so at length. Everything it feeds is scoped by the tenant it returns.
- **The builder shows the URL**, read-only and copyable, with the warning that anyone holding it
  can start the flow.

## Action required

- **Run the migration**: `bun run db:migrate` (`0005_shiny_korath.sql`).
- Webhook URLs are credentials. They appear in the builder for anyone who can open the flow, and
  are not currently rotatable — see the gaps below.

## Verification

Against the running API, with no session on any request:

- Every method accepted: `GET POST PUT PATCH DELETE HEAD` all `202`. (`OPTIONS` answers `204` from
  the CORS middleware, which is correct for a browser preflight.)
- Retry with the same `Idempotency-Key` returned the *same* delivery id and `duplicate: true`.
- Wrong path, unknown flow → `404`; malformed id → `400`; 1.1 MB body → `400`.
- A delivery sent with `Authorization` and `X-API-Key` stored neither — a search of the table for
  those values returns zero rows — while keeping `User-Agent`.

## Known gaps

- **Nothing runs.** Deliveries accumulate unprocessed until the execution engine exists. The
  endpoint is honest about having stored them, not about having acted on them.
- **No rotation.** A leaked URL cannot be changed without recreating the flow. A per-flow webhook
  secret that can be rolled is the fix, and belongs with signature verification below.
- **No signature verification.** Providers that sign their deliveries (Stripe, GitHub) cannot yet
  have those signatures checked, so the URL's unguessability is the only control.
- **No rate limiting.** An unauthenticated write endpoint should have one.
