# Container builds find the auth package, and deployments get their encryption key

- **Date:** 2026-08-16
- **Type:** fix
- **Scope:** `api`, `worker`, `web`, `deploy/coolify`, `packages/shared`

## Summary

Every image failed to build, and would have failed to start once it did. Adding `packages/auth`
introduced a workspace member that no `Dockerfile` copied, so `bun install --frozen-lockfile`
rejected the lockfile in all three; and `SECRETS_KEY`, which the API refuses to start without,
was passed by neither `docker-compose.yml` nor the Coolify one.

## Why

**A workspace member is a build input for every image, not just the ones that import it.**
`--frozen-lockfile` validates the whole lockfile, so a member whose `package.json` is absent fails
the install even in an app that never imports it. The worker and web images do not use
`@automend/auth` and still need its manifest present; only the API additionally needs its source
at runtime. The failure names the `RUN bun install` line rather than the missing file, which is
what made it look like a lockfile problem.

**`SECRETS_KEY` cannot come from a Coolify magic variable.** It must decode to exactly 32 bytes,
and `SERVICE_PASSWORD_64_*` produces a 64-character string that decodes to 48. So unlike
`AUTH_SECRET`, it is operator-supplied, guarded with `:?` so the deployment stops with a message
instead of crash-looping on a container that exits during env validation. Rotating it makes every
stored connector token unreadable, which is why the README says to generate it once and keep it.

**The test that should have caught this named its variables by hand.** `compose.test.ts` asserted
`AUTH_SECRET` and `AUTH_BASE_URL` reached the api service — the two that existed when it was
written — and never looked at the Coolify file at all. It now derives the set from the generated
`.env.example`, so a connector added to `config.ts` extends the assertion on its own, and it
checks both compose files.

## Action required

Deployments must set `SECRETS_KEY` before the next deploy:

```
SECRETS_KEY=$(openssl rand -base64 32)
```

Existing local `.env` files already declare it and need no change.
