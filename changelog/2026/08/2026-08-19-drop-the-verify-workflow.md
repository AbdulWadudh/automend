# Drop the verify workflow

- **Date:** 2026-08-19
- **Type:** chore
- **Scope:** `.github`, `README.md`, `CLAUDE.md`

## Summary

`.github/workflows/verify.yml` is removed. `bun run verify` stays exactly as it is — it is now run
on a laptop before pushing rather than by GitHub Actions on every push and pull request.

## Why

Asked for. Worth writing down what moves with it, because the gates themselves were not the thing
being removed: the workflow was the only thing making them run *without being remembered*. Every
failure it existed to catch — a workspace package no `Dockerfile` copies, a variable no compose file
passes, a migration that applies to an empty database and not to a populated one — is now found by
whoever runs `bun run verify`, or by Coolify ten minutes at a time.

## What changed

- Deleted `.github/workflows/verify.yml`, and with it the last file under `.github/`.
- `README.md` and `CLAUDE.md` said "use in CI" beside `config:check` and `auth:schema:check`, and the
  two generator scripts said the same. They now say to run them before pushing, since there is no CI
  to defer to.

## Action required

**None** for the code. For anyone working on the repo: `bun run verify` before pushing anything that
touches a package boundary, a `Dockerfile`, a compose file or a migration — nothing else will.

## Verification

`bun run verify` locally, which is the whole point of the change.
