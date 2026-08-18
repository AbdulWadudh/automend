# CLAUDE.md — Automend

Instructions for Claude Code when working in this repository. Follow these before relying on
general defaults. If something here conflicts with a general best practice, this file wins.

## What this project is

Automend is a self-hosted, AI-centric workflow automation platform (Activepieces/Windmill-style):
users build flows visually (trigger → steps → branches/loops), the platform executes them
reliably, and it scales horizontally. It is also a learning project — code should be correct,
secure, and easy for a human to read and extend, not clever.

## Tech stack (do not substitute without asking)

| Layer | Choice |
|---|---|
| Runtime | Bun (latest stable) |
| API framework | Hono |
| ORM / migrations | Drizzle ORM + Drizzle Kit |
| Database | PostgreSQL |
| Queue | BullMQ + Redis (deployed as DragonflyDB — see Redis notes) |
| Frontend | React (latest) + Vite |
| Routing / data | TanStack Router + TanStack Query |
| UI components | shadcn/ui + Tailwind CSS |
| Template fields | Lexical (variable chips in step configuration) |
| Flow canvas | @xyflow/react |
| Auth | Better-Auth |
| Validation | Zod (shared between API and frontend) |
| Lint / format | Biome (single tool — do not add ESLint/Prettier) |
| Testing | `bun test`; Playwright for e2e once UI stabilizes |
| Logging | Pino, structured JSON |
| Observability | OpenTelemetry → SigNoz (self-hosted, OTLP-native) |
| Deployment | Docker images, deployed via Coolify |

## Repo structure (Bun workspaces monorepo)

```
apps/
  api/            Hono API — routes, auth, run producers, the kit catalogue endpoint
  worker/         BullMQ consumers, the outbox relay, and the execution engine
    src/engine/   The engine: the DAG walk in the parent, one action at a time in a subprocess
  web/            React app — flow builder UI
packages/
  db/             Drizzle schema, migrations, query helpers (imported by api + worker)
  shared/         Zod schemas, shared types, constants (imported by all apps)
  kit-framework/  The SDK a kit is written against. Browser-safe, so the builder may import it
  kits/           One directory per service: core, http, gmail. Imported by api + worker, never web
```

Each `apps/*` has its own `Dockerfile`. `packages/*` are internal, never published, imported via
workspace protocol.

**Dependency direction, which is load-bearing:** `shared` depends on nothing. `kit-framework` depends
on `shared`. `kits` depends on both. `db` depends on `kits` (it upgrades stored definitions on read).
Nothing depends on an app. `apps/web` must never import `packages/kits` — a kit's code calls
third-party APIs and has no business in a browser bundle, which is why the catalogue is served over
HTTP instead.

## Non-negotiable engineering rules

These override convenience every time:

1. **Never execute flow step code in the API or worker's main process.** It runs in the engine
   subprocess (`apps/worker/src/engine/`), and the boundary is real: the child has no database
   client, no secrets key, and an allowlisted `env`, so `DATABASE_URL` and `SECRETS_KEY` are not
   present to be read. It receives one step's input and one credential at a time.

   Be precise about what that does and does not enforce, because the gap is where a false sense of
   safety lives. **Enforced:** a wall-clock cap on the run and on each step, an output cap, and
   network access only through the guarded client in `engine/http-client.ts`. **Not enforced,
   because Bun's spawn options do not provide it:** memory, CPU, filesystem or network isolation. A
   memory ceiling is a container concern. Never describe this as a sandbox without saying which.
2. **Every flow execution and every step execution needs an idempotency key.** Retrying a step
   must never re-trigger a side effect (double email, double charge). Check-then-act on the key
   inside a DB transaction, never a bare check.
3. **Use the transactional outbox pattern for anything that writes state and enqueues a job in
   the same operation.** Never enqueue a BullMQ job as a side effect of a Postgres write that
   could still roll back.
4. **All DB access goes through Drizzle.** No raw string-concatenated SQL, ever — parameterized
   queries only.
5. **All external input is validated with Zod at the boundary** (API route, webhook receiver,
   queue job payload) before it touches business logic. Don't trust anything from the network.
6. **Secrets (API keys, OAuth tokens, DB creds) are envelope-encrypted at rest**, never stored or
   logged in plaintext. Never log full secret values, even at debug level.
7. **Every table with tenant-owned data has a `tenant_id`/`org_id` column and every query is
   scoped by it.** Do not defer multi-tenancy — retrofitting it later is far more expensive.
8. **No secrets, `.env` files, or credentials committed to git.** Env vars are read via a single
   typed config module (`packages/shared/env.ts`) that validates with Zod at startup and fails
   fast if anything required is missing.

## Kits — how a service gets added

A **kit** is one service's worth of capability: the actions a flow can take and the triggers that can
start one. Adding a service is adding a directory under `packages/kits/src/` and one line in
`registry.ts`. If a change to support a new service touches the builder, the shared schemas, or a
lookup map, something has gone wrong — go back and find the declaration you should have used instead.

| Term | Means |
|---|---|
| **Kit** | One service — `gmail`, `http`, `core` |
| **Action** | Something a kit does — `gmail.sendEmail` |
| **Trigger** | Something that starts a flow — `gmail.newEmail` |
| **Connector** | A credential *type* a workspace can authorise (`config.connectors.providers`) |
| **Connection** | A workspace's authorised instance of a connector (`connections` table) |
| **Run** | One execution of a flow (`flow_runs`) |
| **Step run** | One step's attempt within a run (`flow_step_runs`) |

A kit *names* the connector it needs; it never holds a credential. The engine resolves the connection
and hands the kit one access token for one step.

### Naming

Kit ids and action and trigger names are **camelCase**: `gmail.sendEmail`, `googleSheets.addRow`.
They are identifiers a kit author types and a stored flow refers to. Files and directories stay
**kebab-case**, like everything else here — `src/gmail/actions/send-email.ts` exports
`gmailSendEmailAction` whose `name` is `"sendEmail"`. `createKit` enforces the pattern at import time,
so a malformed kit stops the process at start-up rather than surfacing later as an inexplicable
validation error.

### A property has two lives, and this is the thing to understand first

A field that supports `{{variable}}` holds **text** at rest: a number input configured with
`{{orderCount}}` is the string `"{{orderCount}}"` in the database, and cannot be anything else until
the flow has data. By the time the kit sees it, it has to be a number. So one property map derives two
schemas, and conflating them means choosing which to break:

- `buildStoredInputSchema` — what the builder saves through. Checks *types*, not completeness,
  because a half-configured step is a normal thing to save.
- `buildResolvedInputSchema` — what the engine validates after substitution. Coerces, applies
  defaults, enforces `required`.

The corollary: **length bounds are checked at rest, range bounds after resolution.** `maxLength`
limits what an author can type; `minimum`/`maximum` limit what the data may be, and `{{delayMs}}` has
no magnitude to check.

### Validation is two layers, and the split is forced

`packages/shared` depends on nothing and the browser imports it, so `flowDefinitionSchema` cannot
reach the registry:

- **shared** checks structure — node ids, the graph rules, that a kit id is camelCase.
- **kits** checks meaning — `validateDefinitionAgainstRegistry` resolves the kit and action and
  validates `input` against the property map they were declared with.

The API calls both on save. The engine calls both again before a run, and that is *not* redundant: a
run executes a snapshot, and a kit may have changed between the save and a retry.

`findStepsMissingConnections` is deliberately separate, because the answer is allowed to be no. A flow
saved before its account is connected is a normal state; a *run* that reaches such a step must fail.

### When adding a service

1. `packages/kits/src/<kebab-name>/` with `index.ts` calling `createKit`, and `actions/` and
   `triggers/` beside it. Declare `auth` with `kitOAuth`/`kitToken` naming an existing connector — if
   the connector does not exist yet, add it to `config.connectors.providers` first.
2. Declare every input as a `Property`. Do not hand-write a form; the builder renders from the
   catalogue. Do not add a step kind anywhere — there are none.
3. Reach the network only through `ctx.http`. A kit that calls `fetch` bypasses the address rules, the
   timeout and the response cap, and is the reason those exist in one place.
4. Add the kit to `kits` in `packages/kits/src/registry.ts`.
5. Tests in `packages/kits/tests/<name>/`, against a fake `ctx.http` — assert *what the kit asked the
   service for*, not only what it returned. `tests/registry.test.ts` already asserts the invariants
   that hold across every kit, including that every scope a kit needs is one its connector requests.
6. Nothing else. If you find yourself editing `apps/web`, stop and re-read step 2.

## Configuration — no magic values

**Nothing in this codebase hardcodes a configured value.** Every port, timeout, limit, retry
setting, route path, queue name, service name and default lives in
`packages/shared/src/config.ts` and is imported as `config.<domain>.<value>`. If you are about to
type a number or a string literal that is not purely local to the function you are writing, it
belongs in the config module first.

Two modules, one job each:

| Module | Holds | Rule |
|---|---|---|
| `packages/shared/src/config.ts` | Fixed application constants and the **default** for anything overridable | Imports nothing, so anything (including the browser bundle) may import it |
| `packages/shared/src/env.ts` | Per-deployment overrides, Zod-validated at startup | Its defaults come from `config.ts`; it never hardcodes one |

Decide between them by asking whether the value differs between a laptop and production. If yes,
it is an environment variable whose default lives in config. If no, it is a config constant and
must **not** become an environment variable — "everything is an env var" is as unmaintainable as
scattered literals.

### Derive, never repeat

`config.ts` is split into a **primitives** block and the exported `config` object. A port, host or
path segment is written down exactly once, in the primitives block; everything composed from it —
URLs, CORS origins, route paths, connection strings — is *computed* in the object below.

```ts
// Wrong: 5173 now lives in two places, and one of them will go stale.
defaultOrigins: ["http://localhost:5173"],

// Right: change WEB_DEV_PORT and every origin, proxy target and .env value follows.
defaultOrigins: [httpUrl(LOCAL_HOST, WEB_DEV_PORT), httpUrl(LOCAL_HOST, WEB_PORT)],
```

If you are typing a port number or a hostname inside the `config` object, stop — it belongs in the
primitives block, and the value you were writing belongs in a helper that derives it.

`packages/shared/tests/config.test.ts` asserts these *relationships* (the origin list contains the
web ports, the versioned health route is the base path plus the health path). It never asserts a
literal value, because a test that reads its expectation from config asserts nothing.

### The generated `.env.example`

`.env.example` is **generated** from `config.ts` by `bun run config:sync` — do not hand-edit it.
`docker-compose.yml` then reads those variables through `${VAR}` substitution rather than
restating any port, credential or URL. `bun run config:check` fails when the file is stale; run it
in CI.

Adding an overridable value: put the default in `config.ts`, add the variable to `env.ts` and to
the generator's section list, run `config:sync`, then reference it in `docker-compose.yml` and the
README table — all in the same change.

Deliberately **not** in config, so the rule stays meaningful:

- Standard protocol constants — HTTP status codes on error factories, `"content-type"` header
  names. Nobody reconfigures what `404` means.
- Zod schema structure, and validation messages.
- Tailwind utility classes in components.
- Test fixtures and expected values — a test that reads its expectation from config asserts
  nothing. `tests/config.test.ts` is the exception, and it asserts invariants (queue names carry a
  hashtag, default ports do not collide), never specific values.

## Telemetry

Logs go to **two** destinations, always both, never one instead of the other:

1. **stdout**, as structured JSON (Pino). The container platform captures this — it is what
   `docker compose logs` shows and what survives when the collector is down.
2. **An OTLP collector**, batched and exported in the background. This is what you search.

`createLogger` handles both: pass it an `otelLogger` and it writes through a `pino.multistream`,
bridging each serialised record into an OTel log record. Never add a second logging path.

- **Name things for OTLP, not for SigNoz.** `OTEL_EXPORTER_OTLP_ENDPOINT`, `startLogTelemetry`,
  `config.telemetry`. SigNoz is the backend we happen to run; the code targets the protocol, the
  same way it targets Redis rather than Dragonfly.
- **Logging must never break a request.** Export is batched and asynchronous, failures are dropped
  after retries, and a malformed record is skipped rather than thrown. If you find yourself
  `await`-ing an export on a request path, you have made a mistake.
- **Never route the SDK's own diagnostics through Pino.** An exporter failure logged through the
  logger that feeds the exporter is an infinite loop. The OTel diag channel stays off in the apps;
  `scripts/verify-telemetry.ts` is the one place that subscribes to it.
- **The browser never talks to the collector directly.** It posts to the OTLP prefix on the web
  app's own origin, which the web server proxies onward. That keeps the collector address out of
  the bundle and means it needs no CORS configuration.
- **When proxying, strip `Host` and the hop-by-hop headers** (`config.http.proxy`). Forwarding the
  inbound `Host` makes any CDN-fronted upstream answer 403.
- Verify a change to the pipeline with `bun run telemetry:verify`, which sends marked records
  through the real logger and fails if the collector does not accept them.

## Redis notes (we deploy DragonflyDB)

**Naming rule: code, env vars, config keys and service names all say `redis`.** Redis is the
interface we program against — `ioredis` is the client, `REDIS_URL` is the variable, `redis://` is
the scheme. The server we actually run is DragonflyDB, and that stays an infrastructure detail so
the implementation can be swapped without touching application code. Do not rename things to
`dragonfly`.

The Dragonfly-specific configuration below is *not* optional, and both parts must stay in sync:

- Dragonfly runs with `--cluster_mode=emulated --lock_on_hashtags` (see `docker-compose.yml`).
  Without those flags, BullMQ's Lua scripts force Dragonfly to lock the entire store per script,
  which erases its throughput advantage over Redis.
- **Every BullMQ queue name is wrapped in curly braces** (e.g. `"{flow-executions}"`) so it has a
  hashtag Dragonfly can lock on. Each queue needs a *distinct* hashtag, otherwise every queue is
  assigned to the same thread and serialises behind one another. The braces are inert on stock
  Redis, so these names are correct on either server.

## Coding standards

- **Functions over classes.** Model behaviour with plain functions, factory functions returning
  plain objects, and closures for private state. Do not declare a `class` unless there is no
  reasonable alternative — the two sanctioned cases are (a) constructing third-party objects that
  are classes (`new Hono()`, `new Worker()`, `new Redis()`, `new Pool()`), and (b) nothing else so
  far. Prefer `createThing(deps)` over `new Thing(deps)`, and prefer passing dependencies as
  arguments over holding them as instance state.
- **TypeScript strict mode everywhere.** No `any` unless justified with a comment explaining why.
- **Readability over cleverness.** Prefer a slightly longer, obvious function over a dense
  one-liner. This codebase is for learning — future-you and reviewers should be able to read a
  function top to bottom without re-reading it twice.
- **Small functions, single responsibility.** If a function needs a "and" in its description to
  explain what it does, split it.
- **Descriptive names over comments.** `calculateRetryDelayMs()` beats `calc()` with a comment.
  Reserve comments for *why*, not *what* (e.g., "retry with jitter to avoid thundering herd on
  Redis reconnect", not "loop over items").
- **Comments are rare. The default is none.** A comment is earned only when the code departs from
  what a competent reader would assume: a workaround, a constraint imposed from outside (a library,
  a spec, a platform), a deliberate deviation from the obvious approach, a placeholder that must
  change, or a trap that would otherwise be re-introduced. If a reader would guess right without
  the comment, there is no comment. Restating the code, narrating a section, or explaining a
  well-known pattern is noise — it ages badly and hides the few comments that matter.

  Concretely, and these are the habits to break:

  - **No file-header essays.** A module does not need a paragraph explaining what it is for; its
    name and its exports do that. At most one short line, and only when the file's *boundary* is
    surprising (why this is separate from its neighbour).
  - **No doc block per exported function.** Name the function well instead. A function gets a
    comment only if calling it correctly requires knowing something the signature does not say.
  - **No commentary on config values, schema fields, or types** unless the value itself is a trap
    (a magic number fixed by an external spec, a field whose absence is deliberate).
  - **One reason, one sentence.** When a comment is earned, it says the reason and stops. If it
    runs past two or three lines, it is an argument, not a comment — cut it.
  - Prose density is a review criterion: a diff where comments outnumber statements gets sent back.
- **No God files.** If a route file, service, or component exceeds ~300 lines, split it.
- **Errors are typed, not stringly-typed.** Use the small domain error vocabulary in
  `packages/shared/src/errors.ts` rather than throwing raw strings or generic `Error`. Per the
  functions-over-classes rule these are *factory functions* returning branded `Error` objects
  (`flowValidationError(msg)`, `stepExecutionError(msg)`) and are discriminated with the exported
  type guards (`isAutomendError`), not with `instanceof` on a subclass. `new Error()` inside a
  factory is fine — it is the only way to get a stack trace. Every thrown error must be catchable
  and mappable to a specific HTTP status / execution state.
- **Infrastructure is named for its interface, not its implementation.** See the Redis notes
  above: we code against Redis and deploy Dragonfly. Apply the same reasoning elsewhere — a
  variable called `OBJECT_STORAGE_URL` beats `MINIO_URL` when the code only uses the S3 API.
- **Async code always has explicit error handling.** No unhandled promise rejections in workers —
  an uncaught error in a job handler must be caught, logged with context, and result in the job
  being marked failed (not crash the worker process).
- **API responses use a consistent envelope**: `{ data }` on success, `{ error: { code,
  message } }` on failure. Don't invent a new shape per route.
- **Migrations are the only way schema changes.** Never hand-edit the database; always generate
  and commit a Drizzle migration.

## Interface quality

The builder is the product. A flow editor that looks unfinished is not a working feature with a
cosmetic problem — people judge whether they can trust software with their automations by how it
behaves under their hands. Treat the rules below as non-negotiable as the ones above.

- **Never ship a browser-default control into a themed surface.** A native `<select>` renders its
  option list with the *operating system's* colours, not the page's — on this dark theme it comes
  back light with unreadable items, and no CSS can reach it. Use the Radix-backed component in
  `components/ui`, which renders the list as real DOM. The same applies to any control whose popup
  the browser owns. If a shadcn/Radix component exists for what you are building, use it rather
  than assembling one from `div`s.
- **Every interactive element has all of its states.** Hover, focus-visible, active, disabled and
  loading are part of the component, not an afterthought — a control that looks identical before
  and after you touch it reads as broken. Focus rings are never removed; `:focus-visible` keeps
  them off mouse clicks without stranding keyboard users.
- **Never carry meaning in colour alone.** A red border needs an icon or a message beside it; a
  selected row needs a tick as well as a highlight. Verify text contrast is at least 4.5:1
  *against the dark surface it actually sits on*, not against the light theme's values.
- **Motion explains a change, or it does not exist.** Animate to show where something came from
  (a menu growing out of its trigger) or that state changed. Animate `transform` and `opacity`
  only — animating `width`, `height` or `top` causes layout thrash. Keep it quick enough to feel
  like feedback, honour `prefers-reduced-motion`, and never animate more than a couple of things
  at once.
- **Every asynchronous surface has four states, and all four are designed**: loading, empty,
  error and populated. An empty state says what to do next; an error says what went wrong *and*
  offers a way forward. A spinner alone is not an empty state.
- **Labels are visible, and destructive actions are separated.** A placeholder is not a label — it
  vanishes exactly when the user needs it. Put helper text under the field, errors next to the
  field they belong to, and keep delete away from the controls people use constantly.
- **Ask the design skill before inventing.** For anything beyond a small tweak — a new component,
  a layout, a colour or motion decision — consult the `ui-ux-pro-max` skill first rather than
  guessing. Guessing is what produced the unreadable dropdown this section exists because of.

### Controls

Each of these was a real defect shipped in this codebase, not a style preference.

- **An icon-only control is a `Button`, never a bare Radix trigger.** A trigger renders an
  unstyled `button`: no hover state, no focus ring, and a hit area the size of the glyph — well
  under the 24px a pointer target needs. Use `IconAction`, which wraps `Button` and attaches the
  tooltip and the `aria-label` together.
- **Every icon-only control names itself three ways**: a tooltip that opens on hover *and on
  focus*, and an `aria-label`. A hover-only label does not exist for a keyboard.
- **Put the action on the thing it acts on.** A copy control belongs inside the field holding the
  value, pinned so it survives scrolling — not as a sibling button underneath. If you are adding a
  second element to explain or operate on the first, look for a way to put it *in* the first.
- **Transient content goes in an overlay, not inline.** Revealing a value, showing a picker or
  confirming a detail must not resize the row it sits in: growing a row displaces every control
  beside it, and things that move under the pointer feel broken. Use a popover.
- **The panel scrolls, never the page.** A region with more content than fits — a drawer, an
  inspector, a sidebar, a dialog body — is its own scroll container. The document must not become
  one on its behalf. Letting the page scroll to reveal a form field drags the header and the canvas
  off-screen with it: the user asked to see the bottom of one panel and lost every other part of
  the app to get there.

  Concretely, and these are the two mistakes that cause it:

  - A shell that owns the viewport is `h-dvh overflow-hidden`, **not** `min-h-dvh`. The latter grows
    with its content, which is exactly how the document ends up scrolling.
  - Every flex ancestor between that shell and the scroll container needs `min-h-0`. A flex child
    defaults to `min-height: auto` and refuses to shrink below its content, so the descendant's
    `overflow-y-auto` has nothing to overflow *within* and the overflow escapes upward. This is the
    single most common reason a scroll container appears to do nothing, and adding `overflow-y-auto`
    somewhere higher up is not the fix — it is the bug.
- **Destructive confirmations keep their words.** An icon is fine shorthand for something you can
  undo by clicking again; it is the wrong shorthand for confirming something permanent.
- **Colour comes from the existing palette, and never carries meaning alone.** The node accents in
  `styles.css` are the product's palette — reuse them so a colour means the same thing everywhere,
  rather than inventing a hex per component. Every coloured control still needs its label, because
  a row of glyphs distinguished only by hue is unreadable to a large number of people.
- **A dynamic class name produces no CSS.** Tailwind finds classes by scanning source text, so
  `bg-node-${accent}` yields nothing. Map to full literal class strings.

## Testing expectations

- **Tests live in a `tests/` folder per package, mirroring `src/`** — never beside the file they
  test. `packages/shared/src/env.ts` is tested by `packages/shared/tests/env.test.ts`, importing
  from `../src/env`. Keeping the mirror exact is what makes an untested module easy to spot, which
  is the one thing a separate test tree costs you.
- Business logic (flow validation, execution state transitions, idempotency handling) needs unit
  tests with `bun test`. This is the highest-value test surface in this codebase — prioritize it
  over UI tests early on.
- **Some guarantees cannot be unit-tested, and faking them is worse than not testing them.**
  `packages/db/tests/runs.test.ts` runs against a real Postgres, because `ON CONFLICT` deciding a race
  and `FOR UPDATE SKIP LOCKED` letting two relays work in parallel are *Postgres* behaviour — a mocked
  Drizzle would assert that the code calls the functions it calls, which is worth nothing when the
  whole question is what happens when two callers arrive together. Those tests fire callers
  **concurrently**, skip themselves when `DATABASE_URL` is unset, and are made to actually run by the
  `run persistence against a real database` gate in `bun run verify` — which fails if they *skipped*
  rather than passed, since a skipped suite exits 0 and would otherwise turn the gate green having
  proven nothing.
- **Run the code before claiming it works.** Every platform problem in the engine — Bun's IPC pipe
  failing on Windows, a file URL's leading slash, two SSRF bypasses — was found by executing it, not by
  reading it. A typecheck proves the shapes agree, not that anything happens.
- **Run `bun run verify`, not just `typecheck` and `test`, for anything that touches a package
  boundary, a `Dockerfile`, or a compose file.** Those three gates — compose files resolve, container
  images build, migrations apply to a populated database — are the only ones that catch a whole class of
  problem, and the class is "the code is correct and the deployment is broken". Adding two workspace
  packages once left all three images unable to build, because `bun install --frozen-lockfile` needs
  every manifest the lockfile mentions and no `Dockerfile` copied the new ones. That exact failure is the
  first one `scripts/verify.ts` names in its header comment.

  There is no terminal on the deployed server. **Everything is a compose service or a `package.json`
  script**, so a step that requires someone to log in and run something is not a plan. Migrations are
  applied by the `migrate` service, which `api`, `worker` and `web` all wait on with
  `service_completed_successfully` — never by hand. `bun run db:migrate` is for a database outside the
  compose stack, and does not belong under "Action required" in a changelog.
- Every bug fix gets a regression test before the fix, where practical.
- Don't chase 100% coverage; do make sure the non-negotiable rules above (idempotency, tenant
  scoping, sandboxing) are the parts that are actually tested.

## Git conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- One logical change per commit. Don't bundle a schema migration with an unrelated UI tweak.
- PR/commit description explains *why* a change was made when it isn't obvious from the diff.

## Changelog

**Every feature or notable change gets a changelog entry, written as part of the change — not
afterwards.** A change is not finished until its entry exists.

Entries live in a year/month/date folder structure:

```text
changelog/
  README.md                                  index + conventions
  TEMPLATE.md                                copy this for a new entry
  2026/
    08/
      2026-08-15-bootstrap-monorepo.md
      2026-08-22-flow-execution-engine.md
```

- Path: `changelog/<YYYY>/<MM>/<YYYY-MM-DD>-<kebab-slug>.md`, where the date is when the change
  lands. Create the year/month folders if they don't exist yet.
- Several changes on the same day means several files. Never append to an existing entry to
  describe a different change — one entry, one logical change, matching the commit rule above.
- Start from `changelog/TEMPLATE.md` and keep every section.
- Write about *why* and *what a reader of the code needs to know*, not a diff summary — the diff is
  already in git. Always call out anything that requires action (new env var, migration to run,
  breaking API change).

## Deployment (Coolify)

- Every deployable app (`api`, `worker`, `web`) has its own `Dockerfile`, builds to a small final
  image (multi-stage build, Bun's official slim base image), and reads all configuration from
  environment variables — no config baked into the image.
- Every long-running service (`api`, `worker`) exposes a `/health` endpoint that checks its real
  dependencies (Postgres reachable, Redis reachable) — Coolify uses this for health checks and
  restarts.
- Logs go to stdout/stderr as structured JSON (Pino default) — Coolify captures these directly, no
  file-based logging.
- No service assumes local disk persistence. Anything that must persist goes in Postgres, Redis,
  or an S3-compatible object store — containers are treated as disposable.
- `docker-compose.yml` at the repo root is for local development only (Postgres + Redis + all
  apps) and must not be assumed to be how production runs — Coolify deploys each app's Dockerfile
  independently.

## When implementing a new feature

1. Check if it touches a non-negotiable rule above (idempotency, sandboxing, tenant scoping,
   secrets) — if so, treat that as the actual scope of the task, not an add-on.
1. If it is "support service X", it is a kit — see the checklist above, and do not touch the builder.
2. Add/extend the Zod schema in `packages/shared` first if it changes any request/response or job
   payload shape.
3. Update or add a Drizzle migration if it touches the schema.
4. Write the unit test for the core logic alongside the implementation, not after.
5. Keep the diff scoped to the feature — don't opportunistically refactor unrelated code in the
   same change.