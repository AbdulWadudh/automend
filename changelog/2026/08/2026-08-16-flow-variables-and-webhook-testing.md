# Data received by a flow reaches the steps below it

- **Date:** 2026-08-16
- **Type:** feat
- **Scope:** `packages/shared`, `packages/db`, `api`, `web`

## Summary

A webhook delivers `{ "name": "Ada", … }`, and the steps beneath it can refer to those fields as
`{{name}}`. A drawer in the builder sends a test request and shows what arrived, and the fields of
that payload become the variables the picker offers. Adds a `send-email` step that can be designed
and saved — and says, in the builder, that nothing sends it yet.

## Why

**Substitution, not evaluation.** `{{name}}` looks up a property. There is no expression syntax, no
function call, no arithmetic, and no way to reach anything but a plain property of the data
supplied — a path through `constructor` or `__proto__` resolves to nothing, and an inherited
property is not visible. This is the platform's first rule (user-authored code never runs in a
server process) applied to the place where it would erode most easily: a template language grows an
expression at a time, and each one seems small. If a flow needs a computed value, that is a step,
sandboxed, not an expression in a text box.

**An unresolved variable stays visible.** `Hi {{nickname}}` renders as `Hi {{nickname}}`, not
`Hi `. Rendering it away produces output that reads like a broken flow rather than a template
pointing at a field the payload does not have.

**Variables come from real deliveries, not a declared schema.** The field names in the last payload
are, by definition, the ones that will be there next time. That is why testing the hook and
discovering the data are the same act — the drawer sends a request and the picker fills up.

**The editor's plain text *is* the template.** `VariableNode.getTextContent()` returns `{{path}}`,
so reading the editor gives the string the flow stores. There is no second serializer to write and
therefore none to drift.

## What changed

- **`packages/shared/src/templates.ts`** — `renderTemplate`, `listTemplateVariables`,
  `listSampleVariables`. 22 tests, including the worked example and the paths that must not
  resolve.
- **The email body is rich text.** A body is *written*, not filled in, so it gets bold, italic,
  underline and lists — stored as HTML with the same `{{tokens}}` inside it. Substitution is
  string-level, so one renderer serves both shapes and the markup passes through untouched. Fields
  that are not prose stay plain: bold in a subject line or a URL means nothing. A body saved before
  this change is plain text with no tags, so it is loaded as plain text rather than parsed as HTML
  and lost.
- **Lexical** joins the stack for template fields. Variables are decorator nodes, so a chip behaves
  as one indivisible thing: a caret cannot land inside it and backspace removes the whole variable
  rather than one brace of a token that would then be silently malformed. Typing `{{` opens the
  picker, which lists each variable with a preview of its current value.
- **`GET /api/v1/flows/:id/deliveries`** — tenant-scoped, unlike the webhook write path, because
  the builder reads it with a session and one workspace must not read another's by flow id.
- **A test drawer** that posts straight at the webhook on this origin, exactly as an outside
  service would — no session, no client wrapper — so what it exercises is the real path.
- **`send-email`** step: connection, recipients, subject and body, all templated. Marked in the
  builder as designable but not yet sendable.

## A webhook exists once it is saved

The builder distinguishes the trigger being edited from the trigger that is stored, because the API
routes on the stored one. Switching a trigger to "webhook" and testing it immediately used to
produce `404 No webhook is listening here` — accurate, and useless, since the endpoint cannot
explain a state that only exists in someone's browser.

The URL now says whether it is live, and the drawer refuses to send against an address that does
not exist yet rather than letting the request fail. The endpoint's message is unchanged: it is
deliberately identical for an unknown flow, a wrong path and a non-webhook trigger, so that nobody
holding a flow id can map out how a workspace is configured.

## Action required

None. No migration; the deliveries table already existed.

## Verification

The request's own example, end to end through the running stack — delivered over the webhook, read
back from the database, rendered by the shared code the engine will use:

```
variables : email, name, dob, message, from

to        : abdulwadudh5@gmail.com, abdulwadudh@gmail.com
subject   : Happy birthday
body      : Hi Abdul Wadudh, Congrats on the Birthday
            (blank)
            With Regards
            Samdani
```

`bun test` covers nested paths, arrays, non-string values, prototype access, inherited properties,
expression-shaped input, oversized payloads and unbounded nesting.

## Lexical is deduped in the Vite config

Lexical checks that every node registered with an editor subclasses *its own* `LexicalNode`, so two
copies of the package mean two class identities and an editor that refuses to start:
`nodes[1] ListNode is not a constructor that subclasses LexicalNode`.

Rollup collapses the duplicates when building, which is what makes this deceptive — it only ever
fails in dev, where each pre-bundled dependency can carry its own copy. `resolve.dedupe` in
`vite.config.ts` lists `lexical` and every `@lexical/*` package so the optimizer produces one core
chunk that the rest import.

## Cost

The builder route grew from 250 kB to 549 kB (77 kB → 170 kB gzipped). Lexical is most of it. It is
route-split, so the landing page, sign-in and the flow list are unaffected — but it is a real cost
paid by everyone who opens a flow, and worth revisiting if the editor is ever needed in fewer
places than it is now.

## Known gaps

- **Still nothing executes.** Templates render correctly and are stored; no step acts on them.
- **Variables come only from the trigger's last delivery.** Step outputs — `{{steps.1.status}}` —
  need the engine to have produced any.
- **The renderer does not escape.** Substituting into an HTML body inserts the value verbatim, so
  whatever protects a recipient has to be the step that sends — it is the only part that knows
  whether it is producing HTML or plain text. There is a test asserting this is the behaviour, so
  it is a decision rather than an oversight.
- A delivery whose body is not JSON offers no variables. That is a fact about the payload rather
  than an error, so the picker is simply empty.
