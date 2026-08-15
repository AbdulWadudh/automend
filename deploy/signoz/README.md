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

SigNoz ships a Coolify-specific stack. Generate the current one with
[Foundry](https://signoz.io/docs/install/docker/):

```bash
curl -fsSL https://signoz.io/foundry.sh | bash
foundryctl gen examples
# → docs/examples/coolify/stack/pours/deployment/coolify.yaml
```

A generated copy is committed here as [`coolify.yaml`](coolify.yaml) for reference. Coolify also
has its own SigNoz service template, which is a fine alternative — it deploys an older layout
(Zookeeper + ClickHouse) but exposes the same OTLP endpoints.

In Coolify:

1. **New Resource → Docker Compose**, paste the stack, deploy.
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

## Running SigNoz locally

[`local/`](local/) holds the Foundry-generated Docker Compose stack plus one override of ours.

```bash
cd deploy/signoz/local
cp ../../../.env .env      # supplies the port variables
docker compose up -d
```

- SigNoz UI → <http://localhost:3301>
- OTLP/HTTP → `http://localhost:4318`

`compose.yaml` is generated verbatim by Foundry and is left untouched so it can be regenerated.
Our only change lives in `compose.override.yaml`: SigNoz serves its UI on `8080`, which is also
Automend's web app port, so the local stack publishes it on `3301` instead.

It is a heavy stack — ClickHouse, ClickHouse Keeper and Postgres. If you only need the app running,
`OTEL_LOGS_ENABLED=false` is the cheaper option.

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
