# What Coolify does with the domain, the port and a `:?` default

- **Date:** 2026-08-18
- **Type:** docs
- **Scope:** `deploy/coolify`

## Summary

The deploy guide now says three things it learned the expensive way: the domain must carry the
container port, `SECRETS_KEY` must decode to exactly 32 bytes (with a way to generate one on
Windows), and Coolify does not stop a deploy over a `${VAR:?message}` default the way plain
`docker compose` does.

## Why

Three deployments failed in a row, and none of the three reported the cause.

**The port.** A Compose resource takes its upstream port from the *domain string*, not from the
`_8080` in `SERVICE_FQDN_WEB_8080` and not from the image's `EXPOSE`. A domain saved as
`https://automend.example.com` generates the proxy label `{{upstreams}}` with no port, so the proxy
tries port 80 and every request returns **502** — while the container sits there listening on 8080,
passing its health check, logging nothing. Written as `https://automend.example.com:8080`, Coolify
strips the port before serving and uses it as the upstream.

**The key.** `SECRETS_KEY` was 64 base64 characters, which decodes to 48 bytes, so the api exited
at startup with `SECRETS_KEY must decode to exactly 32 bytes (got 48)`. 64 characters is the shape
of a Coolify `SERVICE_PASSWORD_64_*` value. It also went unnoticed for two deploys because
`parseMasterKey` runs *after* env validation, and an earlier variable was failing first — a
reminder that fixing one startup error only reveals the next.

**The `:?` default.** `${VAR:?message}` stops `docker compose up` with that message. Coolify never
reaches that point: its parser reads the `:?` default and creates the variable **pre-filled with
the message text**. Useful — the field arrives in the UI carrying its own instruction — but it is
not the deploy-time guard the compose file reads as, and left alone the sentence itself reaches the
container.

## What changed

Documentation only, all in `deploy/coolify/README.md`: the domain step now shows the port,
`SECRETS_KEY` gains its byte requirement, the error it produces, and a PowerShell generator for
hosts without `openssl`, and the "fails the deployment" claim is replaced with what Coolify
actually does.

## Action required

**None** for an existing deployment that already works. When adding a service with a domain, write
the container port into the domain.

## Verification

Confirmed against the live deployment: with the domain saved without a port the site answered 502
while the web container logged `web server listening` on 8080; with `:8080` appended and the stack
redeployed, `GET /` answers 200 and `/api/v1/health` reports postgres and redis up.
