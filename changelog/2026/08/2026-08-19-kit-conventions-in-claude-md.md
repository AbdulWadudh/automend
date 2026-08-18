# CLAUDE.md learns about kits

- **Date:** 2026-08-19
- **Type:** docs
- **Scope:** `CLAUDE.md`

## Summary

The repo-structure table, the vocabulary, the naming rule and a "when adding a service" checklist, so
the next kit is written from `CLAUDE.md` rather than by reading five changelog entries.

## Why

**The instructions described a codebase that no longer exists.** The structure table listed two
packages where there are now four, non-negotiable rule 1 described a subprocess as something to build
one day, and nothing said what a kit is. Anyone — human or otherwise — starting from that file would
have added a service the old way: a step kind in the shared schema, a panel in the inspector, three
lookup maps. The whole point of the last five changes was to make that unnecessary, and a stale
instruction file is how the old way comes back.

**Rule 1 needed to become specific rather than aspirational.** "Isolated subprocess with a timeout and
resource limit" is now half-true, and the half that is not matters: Bun's spawn options give a
wall-clock cap, an output cap and a scrubbed environment, and provide nothing for memory, CPU,
filesystem or network. The rule now says which is which and instructs that the engine is never
described as a sandbox without that distinction. A rule that overstates its protection is worse than
one that admits a gap, because only the second gets closed.

**The dependency direction is worth writing down, because two of its edges are not obvious.** `db`
depends on `kits` (it upgrades stored definitions on read), and `apps/web` must never import `kits` —
which is the reason the catalogue is served over HTTP rather than imported. Someone who does not know
the second will "simplify" it and pull every kit's third-party client into the browser bundle.

**The two-lives property rule is the thing a kit author has to understand first**, and it was only
written down inside the framework's own source. Same for the two-layer validation split, which looks
like duplication until you know `packages/shared` cannot reach the registry.

**And a testing rule that this work earned:** run the code before claiming it works. Every platform
problem in the engine — the IPC pipe that does not start on Windows, the file URL's leading slash, and
both SSRF bypasses — was found by executing it. None would have been found by reading it, and the
typecheck was green throughout.

## What changed

- **Structure table** gains `packages/kit-framework` and `packages/kits`, and names
  `apps/worker/src/engine/`. Plus the dependency direction and the rule that `apps/web` never imports
  `kits`.
- **Non-negotiable rule 1** now describes the engine that exists, and separates what it enforces from
  what it does not.
- **A new "Kits" section**: the vocabulary table, the camelCase-identifiers/kebab-case-files rule, why
  a property has two schemas, why validation is two layers, and a six-step checklist for adding a
  service whose last step is "nothing else — if you are editing `apps/web`, stop".
- **Testing expectations** gain the case for the real-Postgres tests and the gate that stops them
  skipping silently, and the instruction to run code rather than read it.
- The **panel-scrolls-never-the-page** rule landed in the previous change; it sits in *Controls*
  alongside the other defects-that-became-rules.

## Action required

**None.** Documentation only.

## Verification

`bun run check`, `bun run typecheck` and `bun test` (442) all clean — no code changed. The claims in
the new section were checked against the code they describe rather than against the changelogs:
`packages/db/package.json` really depends on `@automend/kits`, `apps/web/package.json` really does not,
and `createKit` really does throw on a non-camelCase name at import time.
