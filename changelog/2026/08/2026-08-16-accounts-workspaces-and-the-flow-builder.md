# Accounts, workspaces and the flow builder

- **Date:** 2026-08-16
- **Type:** feat
- **Scope:** `packages/auth` (new), `packages/db`, `packages/shared`, `api`, `web`

## Summary

Automend has users now. You can sign up with an email and password or with Google, which creates
your account and its first workspace together; behind that sign-in, `/app/flows` lists the flows
that workspace owns and `/app/flows/<id>` opens them on a canvas where you add steps, wire them
together and save. Every flow is scoped by workspace, and the API answers 401 without a session.

## Why

Three decisions are worth recording, because none is obvious from the diff.

**Authentication is a package, not part of the API.** Flow steps will act against third-party
services — send the mail, post the message — using OAuth tokens Better-Auth already stores and
refreshes through `auth.api.getAccessToken`. Those calls happen in the **worker**, which has no
HTTP session, so both processes need to build the same instance. Putting it in `apps/api` would
have meant moving it later, once something already depended on where it was.

`account.encryptOAuthTokens` is on from the first migration for the same reason: those rows will
hold the credentials to everything a workspace automates, and turning encryption on afterwards
leaves the tokens written before it in plaintext.

**The tenant is a Better-Auth organization.** A flow cannot be stored without a tenant to scope it
to, so a workspace is created with the account rather than on first use. Membership is confirmed
against the database on every request — the workspace id on a session is a hint, not an
authorisation, because a user can be removed from a workspace while still holding a session that
names it.

**Better-Auth's tables are generated, not transcribed.** `bun run auth:schema` asks the installed
library which tables it needs (`getAuthTables`) and writes `packages/db/src/auth-schema.ts`, the
same way `.env.example` is generated from `config.ts`. Hand-copying a schema from a documentation
page is how a library upgrade silently adds a column nobody notices until a query fails. The
generator makes two deliberate departures, both commented in the file: identifiers are `uuid` so
`flows.tenant_id` can be a real foreign key to `organization.id`, and foreign keys are indexed.

## What changed

- **`packages/auth`** (new). `createAuth(options)` takes its configuration as arguments and reads
  no environment itself. `options.ts` holds the half of the configuration that decides the database
  shape, so the generator can import it without touching a database. `resolveRequestContext`
  turns a request into `{ userId, tenantId }`, confirming membership and creating a missing
  workspace rather than failing on one.
- **`packages/db`**: generated auth tables; `flows` gains `definition` (jsonb), `description`,
  `created_by`, and a foreign key from `tenant_id` to `organization.id`. Query helpers in
  `flows.ts` and `organizations.ts` all take `tenantId` as a required argument, including the ones
  that already have a primary key — that is what turns "not yours" into 404 rather than a leak.
- **`packages/shared`**: `flow-definition.ts` is the new domain core — a trigger, its steps, the
  edges between them, and the graph rules that reject a definition no engine could execute (an
  edge into the trigger, a cycle, an edge to a deleted node). It deliberately allows an
  unconnected step, because that is an ordinary editing state. Adds an `UNAUTHENTICATED` error and
  the `AUTH_*` / `GOOGLE_*` environment variables.
- **`api`**: Better-Auth mounted at `/api/v1/auth/*` — versioned like every other API path, with a
  test asserting that stays true. `/api/v1/auth-providers` reports which sign-in methods this
  deployment configured, so the sign-in page never renders a button that would fail at the
  redirect; it is a *sibling* of the auth subtree rather than a child, because Better-Auth
  generates every path beneath `auth/` and a plugin may add one at any version — anything of ours
  in there would silently shadow it, or be shadowed by it. `/api/v1/flows` is a real tenant-scoped
  CRUD behind a session middleware.
- **`web`**: sign-in and sign-up pages, an `/app` area guarded in `beforeLoad`, the flow list, and
  the builder (`@xyflow/react`). The marketing pages moved under a pathless `_marketing` layout so
  the signed-in app does not inherit the marketing header — their URLs are unchanged. Graph edits
  live in `lib/flow-editor.ts` as pure functions, which is what makes them testable.
- **The public site now leads into the app.** Its calls to action previously all pointed at the
  self-hosting section, which was correct when there was nothing to sign in to. The header shows
  "Sign in" and "Get started", or "Open Automend" for someone with a session; the hero's primary
  action is "Start building", with "Deploy it yourself" kept as the alternate path. The header
  reads only `data` from the session hook, so the landing page renders its signed-out state
  normally when the API is unreachable rather than failing.
- **Buttons show a pointer cursor again.** Tailwind v4's Preflight sets `cursor: default` on
  buttons where v3 set `pointer`, so every button in the app — old and new — looked unclickable.
  Restored once in the base layer rather than by adding a utility class per component.
- **The builder's selects are Radix, not native.** A browser draws an `<option>` list with the
  operating system's colours rather than the page's, so on this dark theme the open list came back
  light with barely legible items — and no CSS can reach it. React Flow is also told
  `colorMode="dark"`, which is what its controls and edges were missing. A new **Interface
  quality** section in `CLAUDE.md` records the rule this broke, along with the state, contrast,
  motion and empty-state expectations that go with it.

## Action required

- **Set `AUTH_SECRET`** — at least 32 characters, no default; the API refuses to start without it.
  `openssl rand -base64 32`. On Coolify it is generated as `SERVICE_PASSWORD_64_AUTH`; rotating it
  signs every user out.
- **Run the migration**: `bun run db:migrate` (`0001_breezy_ink.sql`). It adds `definition` as
  `NOT NULL` with no default, so it will fail against a `flows` table that already has rows — none
  existed, since nothing could write to it before this change.
- `AUTH_BASE_URL` defaults to the dev server origin. It is the **browser's** address, never the
  API's, because that is what OAuth providers redirect back to.
- Google sign-in is optional. To enable it, register `<AUTH_BASE_URL>/api/v1/auth/callback/google`
  with Google and set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; setting one alone leaves
  the provider switched off.
- CI should run `bun run auth:schema:check` alongside `bun run config:check`.

## Verification

- `bun test` (99 tests): graph rules, the builder's edits against the schema the API validates
  with, workspace naming and slug collisions, redirect-target handling, and the env loader's new
  variables.
- Signed up, created a flow, listed, patched and deleted it through the web app's own proxy with
  the production bundle in front of the API — the path a browser actually takes, including the
  session cookie being set first-party on the web origin.
- Cross-tenant isolation: with two accounts in two workspaces, reading and deleting the other
  workspace's flow by id both answer 404, and the flow survives.
- Rejected a definition with an edge into the trigger over HTTP:
  `definition.edges.0: Nothing can connect into the trigger`.

## Known gaps

- Deleting a user leaves their workspace and its flows behind. That is correct for a shared
  workspace, which outlives any one member, but a personal workspace with no members left is
  orphaned. Workspace lifecycle needs its own change.
- Nothing runs a flow yet — the definition is stored, not executed, and the trigger kinds beyond
  `manual` are recorded but not yet registered anywhere.
- Connecting third-party services (the `genericOAuth` work described above) is not built. The
  tokens have somewhere to live and the auth instance is reachable from the worker; the
  tenant-scoped connection registry that points at them is the next change.
