# <Title in sentence case>

- **Date:** YYYY-MM-DD
- **Type:** feat | fix | refactor | chore | docs | test
- **Scope:** <apps/packages touched, e.g. `api`, `worker`, `packages/db`>

## Summary

One or two sentences: what changed, in terms a teammate can act on.

## Why

The constraint, bug, or decision behind the change. This is the part git history cannot recover —
be specific about what would go wrong without it.

## What changed

- Bullet the changes that matter to someone reading or extending the code.
- Name new modules, new conventions and changed contracts.
- Skip anything obvious from the diff (renames, formatting).

## Action required

New environment variables, migrations to run, breaking API changes, manual steps.
Write **None.** explicitly if there are none — never leave this blank.

## Verification

How the change was confirmed to work: commands run, endpoints hit, tests added.
