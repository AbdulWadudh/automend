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
  api/            Hono API — routes, auth, queue producers
  worker/         BullMQ consumers — flow execution engine
  web/            React app — flow builder UI
packages/
  db/             Drizzle schema, migrations, query helpers (imported by api + worker)
  shared/         Zod schemas, shared types, constants (imported by all apps)
```

Each `apps/*` has its own `Dockerfile`. `packages/*` are internal, never published, imported via
workspace protocol.

## Non-negotiable engineering rules

These override convenience every time:

1. **Never execute user-authored flow code in the API or worker's main process.** Step execution
   for arbitrary/untrusted code must run in an isolated subprocess with a timeout and resource
   limit. This is not optional, even in early prototypes.
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
- **Do not comment code that does the expected thing.** A comment is earned only when the code
  departs from what a competent reader would assume: a workaround, a constraint imposed from
  outside (a library, a spec, a platform), a deliberate deviation from the obvious approach, a
  placeholder that must change, or a trap that would otherwise be re-introduced. If a reader
  would guess right without the comment, delete the comment. Restating the code, narrating a
  section, or explaining a well-known pattern is noise — it ages badly and hides the comments
  that actually matter.
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
2. Add/extend the Zod schema in `packages/shared` first if it changes any request/response or job
   payload shape.
3. Update or add a Drizzle migration if it touches the schema.
4. Write the unit test for the core logic alongside the implementation, not after.
5. Keep the diff scoped to the feature — don't opportunistically refactor unrelated code in the
   same change.