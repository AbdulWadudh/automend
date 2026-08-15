# SigNoz

Automend exports logs over OTLP. SigNoz is the backend we run — nothing in the application code
knows that, so any OTLP-compatible backend works.

## What the apps need

Exactly two things, wherever SigNoz lives:

| Variable | Value |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL, **without** `/v1/logs` — the exporter appends it |
| `OTEL_EXPORTER_OTLP_HEADERS` | Empty for self-hosted SigNoz; an ingestion key for a hosted backend |

Set `OTEL_LOGS_ENABLED=false` to run with stdout logging only.

## Deploying on Coolify

Use Coolify's own **SigNoz service template** — that is what this project runs. It deploys a
Zookeeper + ClickHouse layout and exposes the standard OTLP endpoints.

If you would rather generate the stack yourself, SigNoz ships a Coolify-specific one via
[Foundry](https://signoz.io/docs/install/docker/):

```bash
curl -fsSL https://signoz.io/foundry.sh | bash
foundryctl gen examples
# → docs/examples/coolify/stack/pours/deployment/coolify.yaml
```

No copy is vendored here on purpose: the generated stack pins exact ClickHouse and Postgres
versions, and a committed copy nobody runs is a copy nobody updates.

In Coolify:

1. Deploy the SigNoz template (or paste a generated stack as **New Resource → Docker Compose**).
2. Give the **SigNoz** service a domain — that is the UI (container port `8080`).
3. Give the **OTel Collector** service a domain mapped to container port **`4318`** (OTLP/HTTP).
   Automend uses OTLP over HTTP, not gRPC, so `4318` is the only port that needs exposing.
4. Point the apps at the collector domain:

   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-collector-domain>
   ```

   No `/v1/logs` suffix and no port — Coolify terminates TLS on 443 and routes to the container
   port you configured.

5. Confirm delivery with `bun run telemetry:verify` (see below).

### Keep the collector private if you can

A self-hosted SigNoz collector has **no authentication**. A publicly-resolvable OTLP endpoint can
be written to by anyone who finds it, which means log injection and a cheap way to run up storage.
Prefer one of:

- Put the apps and SigNoz in the same Coolify project/network and use the internal service name
  (`http://<collector-service>:4318`) with **no** public domain on the collector.
- If it must be public, restrict it at the edge — Cloudflare WAF rules, an IP allow-list, or
  Coolify's basic-auth middleware, and set `OTEL_EXPORTER_OTLP_HEADERS` accordingly.

The browser telemetry path does not need the collector to be public: the browser posts to the web
app's own origin and the web server proxies onward from inside the network.

## Developing without a collector

There is no local SigNoz stack in this repo. Running one means ClickHouse, ClickHouse Keeper and
Postgres on your machine to read log lines you can already see on stdout — every service logs to
both, so nothing is lost by skipping the collector.

```bash
OTEL_LOGS_ENABLED=false
```

Set that in `.env` and the apps run with stdout logging only. Point
`OTEL_EXPORTER_OTLP_ENDPOINT` at the deployed collector when you do want records in SigNoz.

If you genuinely need one offline, generate it with `foundryctl gen examples` (above) — note that
SigNoz serves its UI on `8080`, which collides with Automend's web app, so republish it on another
host port.

## Verifying

```bash
bun run telemetry:verify
```

Sends three marked records (info, warn, error) through the **real** logger — the Pino bridge,
severity mapping and exporter — and fails if the collector does not accept them. It prints a marker
to search for in SigNoz:

```
Logs → filter:  verificationMarker = automend-verify-…
       or:      service.name = automend-telemetry-verify
```

Service names you should see once traffic flows: `api`, `worker`, `web`, and `web-browser` for
records reported from the user's browser.
