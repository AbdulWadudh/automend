# Changelog

Every feature or notable change to Automend gets its own entry here, written as part of the change
rather than reconstructed later.

## Structure

```text
changelog/
  README.md          this file
  TEMPLATE.md        copy this to start a new entry
  <YYYY>/
    <MM>/
      <YYYY-MM-DD>-<kebab-slug>.md
```

- The date in the filename is the day the change lands.
- Several changes on one day means several files — one entry per logical change, the same
  granularity as a commit. Never append an unrelated change to an existing entry.
- Create the year and month folders as needed.

## Writing an entry

Copy [TEMPLATE.md](TEMPLATE.md) and keep every section. The diff is already in git, so the entry
should explain what git cannot:

- **Why** the change was made — the constraint, bug or decision behind it.
- **What a reader of the code needs to know** — new conventions, new modules, changed contracts.
- **Action required** — new environment variables, migrations to run, breaking API changes. If
  there is none, say so explicitly; a reader should never have to guess.

## Index

### 2026

| Date | Entry | Type |
|---|---|---|
| 2026-08-15 | [Add a deployment preflight check and Coolify deployment notes](2026/08/2026-08-15-coolify-deployment-preflight.md) | feat |
| 2026-08-15 | [Export logs from every service to SigNoz over OTLP](2026/08/2026-08-15-signoz-log-export.md) | feat |
| 2026-08-15 | [Centralise all configuration into a single derived source](2026/08/2026-08-15-centralise-configuration.md) | refactor |
| 2026-08-15 | [Bootstrap the monorepo skeleton](2026/08/2026-08-15-bootstrap-monorepo.md) | feat |
