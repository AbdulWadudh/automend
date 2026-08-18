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
| 2026-08-18 | [Signing in works again: the web proxy hands redirects to the browser](2026/08/2026-08-18-proxy-passes-redirects-through.md) | fix |
| 2026-08-18 | [A failing health check says what it saw](2026/08/2026-08-18-health-probe-says-why.md) | fix |
| 2026-08-18 | [The public web address is set explicitly, not read from a Coolify magic variable](2026/08/2026-08-18-coolify-public-web-url.md) | fix |
| 2026-08-18 | [One command that fails the way a deploy would](2026/08/2026-08-18-verify-before-deploying.md) | feat |
| 2026-08-16 | [Container builds find the auth package, and deployments get their encryption key](2026/08/2026-08-16-container-builds-and-deploy-environment.md) | fix |
| 2026-08-16 | [Data received by a flow reaches the steps below it](2026/08/2026-08-16-flow-variables-and-webhook-testing.md) | feat |
| 2026-08-16 | [A real inbound endpoint for webhook triggers](2026/08/2026-08-16-flow-webhook-endpoints.md) | feat |
| 2026-08-16 | [Connectors, and a builder you can drive from the keyboard](2026/08/2026-08-16-connectors-and-builder-interactions.md) | feat |
| 2026-08-16 | [Accounts, workspaces and the flow builder](2026/08/2026-08-16-accounts-workspaces-and-the-flow-builder.md) | feat |
| 2026-08-15 | [Move the local stack to Postgres 18 and fix its volume mount](2026/08/2026-08-15-postgres-18.md) | chore |
| 2026-08-15 | [Add a deployment preflight check and Coolify deployment notes](2026/08/2026-08-15-coolify-deployment-preflight.md) | feat |
| 2026-08-15 | [Export logs from every service to SigNoz over OTLP](2026/08/2026-08-15-signoz-log-export.md) | feat |
| 2026-08-15 | [Centralise all configuration into a single derived source](2026/08/2026-08-15-centralise-configuration.md) | refactor |
| 2026-08-15 | [Bootstrap the monorepo skeleton](2026/08/2026-08-15-bootstrap-monorepo.md) | feat |
