# The kit framework: how a service gets added

- **Date:** 2026-08-18
- **Type:** feat
- **Scope:** `packages/kit-framework`, `packages/shared`

## Summary

`@automend/kit-framework` is the SDK a **kit** is written against. A kit is one service's worth of
capability — Gmail, Slack, HTTP — bundling the actions a flow can take and the triggers that can
start one. Adding a service should be adding a directory, and this is the package that makes that
true: declare your inputs as properties, write a `run`, and you get a form, validation, a typed
`ctx.input` and a catalogue entry without touching the builder or the shared schemas.

Nothing uses it yet. The kits themselves, the registry and the engine follow in the next changes.

## Why

**Adding a service currently means editing six files.** A step's shape is a closed Zod union in
`flow-definition.ts`, and each variant has a hand-written React panel plus entries in a label map, an
icon map and an accent map. Slack would touch all of them, and so would the one after that.
Inverting it — the kit declares its inputs, everything else is derived — is the only version of this
that scales.

**A property has two lives, and conflating them breaks one of them.** A field that supports
`{{variable}}` holds *text* at rest: a number input configured with `{{orderCount}}` is the string
`"{{orderCount}}"` in the database and cannot be anything else until the flow has data. But by the
time the kit sees it, it has to be a number. So there are two schemas derived from one property map:

- `buildStoredInputSchema` — what the builder saves through. Checks *types*, not completeness,
  because a half-configured step is a normal thing to save.
- `buildResolvedInputSchema` — what the engine validates after `renderTemplate` has run. Coerces to
  the declared type, applies defaults, enforces `required`.

Collapse them into one and you get to choose which thing to break: reject `{{count}}` on save and the
builder cannot store work in progress; accept `"abc"` at run time and a kit is handed a number that
is not one.

**`z.coerce.number()` turns an empty field into `0`.** That is the sharp edge of the above, and it is
why the resolved schema treats blank as absent before coercing — an optional number left empty stays
undefined, and a required one fails instead of silently becoming zero.

**Kits get a context, not a runtime.** `ActionContext` carries the step's input, one credential, a
guarded HTTP client, a dedupe store and a logger. There is no `fetch`, no `fs`, no database client
and no master key, and that list *is* the sandbox contract — a kit handed real `fetch` could bypass
the SSRF guard, the timeout and the response size cap that the engine enforces in one place. OAuth
connections arrive as an access token rather than a refresh token, so the subprocess holds nothing
reusable beyond the run it is part of.

**Dedupe is the same problem for every service, so it is solved once.** A polling trigger gets back a
list that mostly repeats last time's answer. Getting "what is new" wrong means running a flow twice
for one email, or missing one entirely. Two strategies, matching the two guarantees services actually
offer: `timestamp` for a service that dates its records, `lastItem` for one that only promises an
order. Two decisions worth knowing about:

- A cursor that has aged out of the listing causes **re-reporting, not skipping**. Over-reporting is
  recoverable — the run's idempotency key stops the side effect happening twice — whereas concluding
  nothing is new would drop every event since, silently.
- A backlog is capped at `config.kits.maxPollItems` from the **oldest** end, so a trigger that was
  off for a week drains in order across successive polls instead of jumping to the present.

**Factory functions, not classes**, per the codebase rule — the Activepieces equivalent returns
`new IAction(...)`. And the definitions are *not* generic: the registry, the catalogue and the engine
handle actions from every kit in one list, which they could not do if each action's type carried its
own property map. The generics live only in the `createAction`/`createTrigger` signatures, where they
type the author's `run`; the values are uniform. That costs exactly one `as` cast, in one place, sound
because the engine validates input against the same `props` before calling.

**Freezing happens once, over the finished tree.** Kit definitions are module-level singletons
serving every run in a worker that may stay up for weeks, so a stray mutation would not fail near the
bug — it would quietly change later runs. `readonly` says this, but the registry passes actions
around with generics erased. Note that `Object.freeze` is *shallow*: freezing a kit leaves its
`actions` array and its properties' `options` arrays mutable, so per-factory freezing would have been
protection in name only. `deepFreeze` over the assembled registry is the version that is actually
true.

## What changed

- **New package `@automend/kit-framework`.** Browser-safe in full — types, plain-data descriptors and
  pure functions — so the builder can import it for rendering without kit code reaching the bundle.
- `Property.shortText/longText/number/checkbox/staticDropdown/json`. **Templatability is decided by
  type, not by the kit author**: a toggle has nowhere to type a variable into and a dropdown's value
  must stay one of its options, so those two are the exceptions. A `json` property cannot declare a
  default, and the type says so — a default is expressed in resolved space, and there is no sound way
  to feed an already-parsed value back through the text it is parsed from.
- `createAction`, `createTrigger`, `createKit`, `kitOAuth`, `kitToken`. **`connectorId` is typed
  against `config.connectors.providers`**, so a kit cannot name a connector this platform does not
  have. A kit *names* the connector it needs; it never holds a credential.
- **`createKit` validates at import time**, so a malformed kit stops the process at start-up rather
  than surfacing as an inexplicable validation error the first time somebody builds a flow: camelCase
  ids and names, no duplicate names within a kit, no dropdown declared with zero options.
- **Naming convention**: kit ids and action/trigger names are camelCase (`gmail.sendEmail`,
  `googleSheets.addRow`) because they are identifiers a kit author types and a flow stores. Files and
  directories stay kebab-case, matching the rest of the repo — `src/gmail/actions/send-email.ts`
  exports `gmailSendEmailAction` whose `name` is `"sendEmail"`. `KIT_NAME_PATTERN` enforces it.
- `toKitCatalogue()` plus the Zod schemas the web app parses it with. A trigger carries
  `schedulable`, derived from `config.kits.schedulableTriggerStrategies` — `polling` and `cron` report
  `false` until the scheduler exists, so the builder can refuse them **with a reason** instead of
  accepting a flow that would silently never run. Flipping them on later is one line in config.
- `config.kits` — property types, trigger strategies, schedulable strategies, dedupe strategies, poll
  caps. Application constants, not environment variables: they do not differ between a laptop and
  production.

## Action required

**None.** No environment variables, no migrations, no API changes. `config.kits` is additive and
`.env.example` is unchanged.

## Verification

`bun test packages/kit-framework` — 63 tests. The ones worth reading are in
`tests/input-schema.test.ts`, which pins the stored-versus-resolved divergence including the
empty-string-to-zero trap, and `tests/dedupe.test.ts`, which covers both strategies against a real
in-memory store: enabling a trigger reports nothing as new, a repeated answer returns nothing, an
aged-out cursor re-reports rather than skipping, and a backlog drains oldest-first across polls.

`bun run typecheck`, `bun run check` and `bun run config:check` all clean.
