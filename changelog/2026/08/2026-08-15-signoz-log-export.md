# Export logs from every service to SigNoz over OTLP

- **Date:** 2026-08-15
- **Type:** feat
- **Scope:** `packages/shared`, `apps/api`, `apps/worker`, `apps/web`, `deploy/signoz`

## Summary

All four log sources — the API, the worker, the web server and the user's browser — now export
their records over OTLP to SigNoz, in addition to the structured JSON they already write to stdout.

## Why

The bootstrap step gave every service Pino logging to stdout, which is fine for one machine and
useless across several: correlating a failed flow execution across the API and the worker meant
reading two containers' output by hand.

Logs go to *both* destinations rather than replacing stdout. Stdout is what the container platform
captures and what still works when the collector is unreachable; the collector is what you search.
Dropping stdout would trade a debuggable outage for a silent one.

The tech-stack row in CLAUDE.md previously said Prometheus/Grafana. SigNoz replaces that: it is
OTLP-native, so one exporter covers logs, and later traces and metrics, with no second agent.

## What changed

- **`packages/shared/src/telemetry.ts`** builds the OTLP log pipeline (`startLogTelemetry`) and
  returns a logger plus a `shutdown` that flushes on the way out.
- **`createLogger` takes an optional `otelLogger`** and, when given one, writes through a
  `pino.multistream`: stdout unchanged, plus a bridge stream that parses each serialised record and
  re-emits it as an OTel log record. Pino's level label maps to an OTel severity number; non-
  primitive fields (a serialised error, a nested context) are stringified rather than dropped.
- **Nothing is SigNoz-specific.** `OTEL_EXPORTER_OTLP_ENDPOINT`, `config.telemetry`,
  `startLogTelemetry` — the code targets OTLP, the same way it targets Redis rather than Dragonfly.
- **Browser errors are captured** by `apps/web/src/lib/telemetry.ts`: uncaught errors and unhandled
  rejections, flushed on `pagehide`. Console output is deliberately not mirrored — high volume, and
  the most likely place for user data to leak into telemetry.
- **The browser never reaches the collector directly.** It posts to the OTLP prefix on the web
  app's own origin; the web server (and the Vite dev server) proxies onward. The collector address
  stays out of the bundle and needs no CORS configuration.
- **The proxy now strips `Host` and hop-by-hop headers** (`config.http.proxy`). Forwarding the
  inbound `Host` made the CDN-fronted collector answer 403 — see Verification.
- **`bun run telemetry:verify`** sends marked records through the real logger and fails if the
  collector rejects them. It is the one place that subscribes to the OTel diagnostic channel;
  routing exporter errors through the logger that feeds the exporter would loop forever.
- `deploy/signoz/` holds the Foundry-generated Coolify stack, a local Docker Compose stack, and the
  deployment notes.

## Action required

**New environment variables** (already in the regenerated `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `OTEL_LOGS_ENABLED` | `true` | Set `false` to run with stdout logging only |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Collector base URL, **no** `/v1/logs` suffix |
| `OTEL_EXPORTER_OTLP_ENDPOINT_FROM_CONTAINER` | `http://host.docker.internal:4318` | Same collector as seen from inside a container |
| `OTEL_EXPORTER_OTLP_HEADERS` | empty | Ingestion key for a hosted backend |

Run `cp .env.example .env` again, or add the four variables to an existing `.env`.

**Security:** a self-hosted SigNoz collector has no authentication. If its OTLP endpoint is exposed
on a public domain, anyone who finds it can inject log records and run up storage. Prefer keeping
it on the internal network and letting the web server proxy reach it; if it must be public,
restrict it at the edge. See `deploy/signoz/README.md`.

## Verification

Against a live SigNoz deployed on Coolify:

- Raw OTLP POST to the collector — `200 {"partialSuccess":{}}` (zero rejected records).
- `bun run telemetry:verify` — 3 records (info/warn/error) exported and accepted, no diagnostic
  errors, stdout output unchanged.
- Full stack rebuilt with telemetry on: api, worker and web all healthy, traffic generated across
  all three plus a queue round-trip, and **no exporter errors in any service log**.
- Browser path: `POST /otlp/v1/logs` through the web container → `200 {"partialSuccess":{}}`.
- `bun test` 40 pass · `bun run typecheck` 5/5 clean · `bunx biome check .` clean ·
  `bun run config:check` up to date.

The 403 caught above is worth recording: proxying with `new Request(url, originalRequest)` copies
the inbound `Host` header, so the CDN in front of the collector rejected the request as an unknown
host. The API proxy had the same latent bug — it only worked because an in-network upstream does
not validate `Host`.
