# Three kits, and what writing them taught the framework

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `packages/kits`, `packages/kit-framework`, `packages/shared`

## Summary

`@automend/kits` is the catalogue: `core` (manual, webhook and schedule triggers; delay and log actions),
`http` (one `request` action), and `gmail` (`sendEmail`, plus a polling `newEmail` trigger). The registry
in `src/registry.ts` is what the API serves the builder from and what the engine will dispatch through.

Writing the first real kits found four gaps in the SDK shipped yesterday, all fixed here — details under
*What the kits taught the framework*, because each one is a decision worth knowing rather than a tweak.

Still nothing executes: the engine is the next change.

## Why

**One package, a directory per service.** Activepieces has a package per piece because pieces are
installed at runtime from a registry; we have a fixed set in a monorepo. Two hundred `package.json` files
would buy nothing. Adding a service is a directory plus one line in `registry.ts`.

**`http` exists so a missing kit is never a dead end.** Without it, "we have no Xero kit" would mean "you
cannot automate Xero". It needs no credentials of its own because whatever the call requires goes in the
headers.

**A kit's upstream URL is not configuration.** `gmail/common/api.ts` holds
`https://gmail.googleapis.com/gmail/v1` rather than `config.ts`. This is a deliberate reading of the
no-magic-values rule: nobody deploys Automend against a different Gmail, so it is not a per-deployment or
per-product value, and putting every kit's endpoints in the shared config would couple the platform's
configuration to its catalogue and grow it without bound. It is written once and every path derived from
it, which is the same discipline applied locally.

**Gmail polls rather than subscribes.** The watch API needs a Cloud Pub/Sub topic, and a self-hosted
deployment should not be obliged to run one. It dedupes on `lastItem` rather than `timestamp` because
Gmail's listing is stable and newest-first, whereas `internalDate` is when Gmail *received* a message and
is not monotonic across the delays a mail server introduces — two messages can arrive out of order, and a
timestamp cursor would skip the later-dated one.

**Assembling a MIME message makes the kit responsible for two things Google would otherwise handle.**
`users.messages.send` takes a whole RFC 2822 message in a `raw` field, so:

- **Header injection is a live risk, not a theoretical one.** Every field can hold a `{{variable}}`, so
  its value comes from whatever the flow received — a webhook body, an email, a spreadsheet cell. A
  newline inside a header value ends that header and begins another, so a subject of
  `Hi\r\nBcc: everyone@example.com` would turn one recipient into a list nobody chose. CR and LF are
  collapsed to a space in every header value, and there are tests for the subject, the recipient, bare
  linefeeds and folded whitespace.
- **A non-ASCII subject must be an RFC 2047 encoded-word.** Sent as raw bytes it produces mojibake in the
  recipient's client rather than an error anyone would notice.

**A failing status is returned by `http.request` and thrown by `gmail.sendEmail`, on purpose.** Reporting
what a URL answered is the whole job of the former, and a 404 from a lookup is often the answer the flow
wants; stopping is the author's decision, made through the step's error handling. A kit acting *on* a
service is the opposite case — a 403 from Gmail means the step did not do what was asked, so continuing
would be a lie. `assertOk` carries Gmail's own message through, because "insufficient authentication
scopes" is the difference between a bug and a reconnect.

**`gmail.sendEmail` does not echo the body it sent.** A step's output goes into the run journal, and a
journal is not the place to keep a second copy of everything anyone has ever emailed. The `newEmail`
trigger fetches `format=metadata` for the same reason.

## What the kits taught the framework

Each of these was a gap that only appeared once a real kit tried to declare a real field.

1. **`templatable` is now a per-type default a property can decline.** A webhook's path and a cron
   expression are *structural* — read to match a request or register a schedule, long before a flow has
   any data — so a variable picker on them would advertise something that could never resolve.
2. **A number property can declare `minimum`/`maximum`.** `core.delay` needs it, and bounds are a
   resolved-space concern for the same reason types are: `{{retryAfterMs}}` has no magnitude, so a stored
   value cannot be range-checked and must not be rejected for it.
3. **Text properties have a `maxLength`, defaulted per type from `config.kits.textMaxLength`.** v1 bounded
   these in `flow-definition.ts` and v2 would have lost it. The point of the default is that *unbounded*
   is not what an author gets by forgetting — a flow definition is one `jsonb` document written whole, so
   one unbounded field is a way to produce a row nobody can load. It is the mirror image of a number's
   bounds: **length limits what an author can type; range limits what the data may be**, so length is
   checked at rest only and never re-checked after substitution, where a short template may legitimately
   produce a large value.
4. **`Required` is a `const` type parameter on every property builder** — and this one is load-bearing,
   not cosmetic. Because a kit declares properties *inline* inside the `createAction` spec, the object
   literal takes a contextual type of `InputPropertyMap`; since that mentions `ShortTextProperty<boolean>`,
   the contextual type pinned `Required` to `boolean` before the argument was looked at. `required: true`
   was silently forgotten, `ResolvedInput` made every field `| undefined`, and every action had to open
   with guards against a case the resolved schema has already made impossible.
   `tests/input-typing.test.ts` is a compile-time regression test for it, because nothing about the fix
   is evident from a call site.

A fifth was found *by* a test: making `templatable` optional meant the stored schema's `default` branch
silently accepted anything for a non-templatable text field. That switch is now exhaustive.

## Also changed

- **`config.engine`** — step and run timeouts, output cap, and the guarded HTTP client's request timeout,
  redirect limit, response cap and blocked address list. The comment states plainly that Bun's spawn
  options provide no memory, CPU, filesystem or network limit, so a memory ceiling is a container concern
  and is not pretended to here.
- **`config.flows.delay.maxMs` is now derived from the step timeout, and is much shorter than the hour it
  was.** A delay genuinely blocks its step, because suspending and resuming a run does not exist yet — so
  a wait longer than the step timeout would be killed mid-wait. Deriving it means the two can never
  contradict each other, and `tests/config.test.ts` asserts the relationship.

## Action required

**None** for a deployment — no environment variables, no migrations, no API changes.

Worth knowing if you have a dev flow with a long `delay` step: the maximum wait is now five minutes less
a little headroom, rather than an hour. Such a step fails at run time with a range error rather than being
silently truncated, which is the honest outcome — but the engine does not exist yet, so nothing can hit it
today.

## Verification

`bun test` — 316 across the repo, 39 of them new in `packages/kits`. The ones worth reading:

- `tests/registry.test.ts` asserts invariants over *every* kit rather than any one of them, so a new kit
  fails here rather than in somebody's flow: unique ids, camelCase names, every trigger carries sample
  data, every kit needing credentials names a real connector, and **every scope a kit needs is one its
  connector actually requests** — a kit promising a scope its connector does not ask for would be
  authorised without it and fail at the API.
- `tests/gmail/mime.test.ts` covers header injection from four angles and the encoded-word round trip.
- `tests/gmail/new-email.test.ts` confirms details are fetched only for genuinely new messages, and that
  the trigger's advertised `sampleData` keys match the payload it actually produces — otherwise the
  builder offers variables that never arrive.

`bun run typecheck` (8 packages), `bun run check` and `bun run config:check` all clean.
