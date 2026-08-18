# One command that fails the way a deploy would

- **Date:** 2026-08-18
- **Type:** feat
- **Scope:** `scripts`, CI, repository configuration

## Summary

`bun run verify` runs, on a laptop, every gate a deployment would otherwise discover for you:
lint, types, tests, the two generated-file checks, both compose files resolving, all three
container images building, and this branch's migrations applying to a database populated at the
release it would deploy over. A GitHub Actions workflow runs the same command, and
`.gitattributes` normalises line endings so `bun run check` stops failing on files nobody touched.

## Why

Four deployments failed in a row, each teaching one fact that a local command already knew:

- a workspace package no `Dockerfile` copied, so `bun install --frozen-lockfile` rejected the
  lockfile in all three images
- `SECRETS_KEY` passed by neither compose file, so the api exited during env validation
- a colon inside a `${VAR:?message}` default, which is not valid unquoted YAML
- `ADD COLUMN definition jsonb NOT NULL` against a table that already had rows

The checks to catch the first three existed and simply were not run together, and nothing ran them
automatically — there was no CI at all. So `verify` is mostly wiring, and the workflow is what
makes it non-optional.

**The migration gate is the one that needed building.** A migration is normally only tested against
an empty local database, where adding a `NOT NULL` column with no default and a foreign key to a
table that did not exist yet both succeed. Against a populated one they do not. The gate applies the
reference release's migrations to a throwaway Postgres, fills it, then applies this branch's — and
it reproduces that fourth failure in about ten seconds.

**Its rows are derived, not written down.** A fixture file is authored against one schema while the
reference release keeps moving, so it quietly stops matching and the replay starts proving nothing
while still reporting success. Instead the seeder reads `information_schema`, synthesises a row per
table, fills foreign keys from rows already inserted, and repeats until no more tables can be
filled — which resolves insert order without topologically sorting the constraints. If it can
populate nothing, the gate fails rather than passing on an empty database.

`--fast` exists because two gates need images built. Everything else finishes in about six seconds,
which is the version worth running on every save; CI always runs all of it.

## Action required

None. `bun run verify` before pushing is the habit worth forming — `--fast` if you are iterating.

Two things it deliberately does not do: it never touches the working tree it is verifying (the
reference migrations are read with `git show` into a temporary directory), and it stops at the first
failing gate, because the gates after it take minutes and the first failure is the thing to fix.
