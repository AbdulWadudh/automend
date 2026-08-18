# A bare variable name resolves against the data that arrived

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `packages/shared`

## Summary

`{{email}}` now resolves to what a webhook posted as `email`, by falling back to `trigger.body.email` and then
`trigger.email`. A path that names a root explicitly — `{{trigger.body.email}}`, `{{steps.sendEmail.messageId}}`
— is unchanged, and still means exactly and only what it says.

## Why

The earlier fix made the *picker* insert `{{trigger.body.email}}`, which is correct and is what the builder now
produces. But it left every flow configured before that holding paths that could never resolve, and it left
anybody hand-writing a template needing to know that a webhook's JSON body sits at `trigger.body` — a rule the
data itself gives no hint of.

This was raised three times in one session, each time from the same reasonable position: *the payload plainly
contains `email`, so `{{email}}` should find it*. The counter-argument was that the run context has two roots
and a bare name has no defined meaning in it. That is true of the implementation and beside the point for the
person writing the field. A rule the data does not suggest is a rule that gets broken.

So a rootless path is now a **shorthand**, resolved where such a name almost always means: the trigger's body
first, then the trigger's envelope — which is also what makes `{{method}}` work.

## What changed

- **`packages/shared/src/config.ts`** — `flows.templates.rootlessVariableFallbacks`, ordered most-specific
  first.
- **`packages/shared/src/templates.ts`** — `renderTemplate` tries each candidate for a path that names no root.
  Three rules, each with a test:
  - **Explicit always wins.** A path beginning `trigger` or `steps` is never rewritten. Falling back for those
    would make the two roots interchangeable and the explicit form meaningless — `{{trigger.email}}` names a
    place that does not exist, and still says so.
  - **The body shadows the envelope.** If a body contained a field called `method`, `{{method}}` is the body's.
    The body is the part the author controls, so it is what a bare name means.
  - **A genuine miss is still a miss.** `{{noSuchField}}` is reported unresolved, which — since the previous
    change — stops the step rather than travelling onward.

The variable picker still inserts fully-qualified paths, and deliberately: generated output should be
unambiguous, while something typed by hand can afford to be lenient.

## Action required

**None.** No environment variable, no migration, no API change. Flows holding bare paths — which is every flow
configured before the picker was fixed — start working without being re-edited.

## Verification

`bun run verify` — all nine gates, 561 unit tests.

- **Against the payload from the report**, using the engine's own context builder: `{{email}}`,
  `{{name}}`, `{{message}}`, `{{from}}` and `{{method}}` all resolve to the right values, `{{trigger.body.email}}`
  still resolves to the same thing, and `{{nope}}` is still reported unresolved.
- **The ambiguity rules are pinned rather than implied.** A test asserts a rootless path and its explicit
  counterpart produce the *same value* — two spellings, never two meanings — plus the shadowing order and that an
  explicit root is never rewritten.
- **One earlier test was rewritten, not deleted.** It asserted that unprefixed paths were unresolvable, which is
  precisely the behaviour being reversed here; the replacement asserts the round-trip instead. Its comment records
  why, so the reversal is not mistaken later for a regression.
