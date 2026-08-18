# The engine: flows actually run

- **Date:** 2026-08-19
- **Type:** feat
- **Scope:** `worker`, `packages/shared`, `apps/web`

## Summary

Flows execute. The worker claims a run, resolves its credentials, spawns an engine subprocess, walks the graph and
journals each step. A webhook now leads to work being done rather than to a row nobody drains.

Also in here: the connection picker the builder was missing, a page that no longer scrolls when a panel should, and
thin scrollbars.

## Why

**The parent drives the walk; the subprocess executes one action at a time.** This is a deliberate departure from
the shape this was planned in, where the child would have walked the graph itself, and it is better on every axis
that matters:

- Every database write stays in the parent. The child holds no connection, so a kit cannot record something that
  did not happen or read another workspace's rows.
- The child receives *one step's* input and *one* credential at a time rather than every credential the run needs.
  A kit with a bug or a bad dependency reaches no further than the step it is running.
- The idempotency claim falls out naturally: the parent claims the step, then asks for it to be run.
- No request/reply machinery for journal writes or store reads, because nothing in the child needs them.

**A retried job replays rather than repeats.** `claimStepRun` either grants the claim or reports that this exact
attempt is already recorded — and in that case the stored output is used and the action is *not* invoked. That is
the whole reason a third attempt at a flow does not send a third email, and it is verified against a real Postgres
rather than asserted.

**A failure stops the run unless the author said otherwise, and the skipped steps are written down.** "These three
did not run" is information; an absence looks like data loss.

**A step whose input does not resolve never reaches the subprocess.** Template substitution and coercion happen in
the parent — pure, unit-testable, and the last point at which a step can be refused before it touches the world.

**Credentials are resolved up front.** A flow that emails and then posts to Slack should not send the email if the
Slack connection was revoked: the partial run is the worse outcome, because it is the one nobody can undo.

**A `retryOnFailure` switch is still absent**, because BullMQ retries the whole run and per-step retry does not
exist. A setting that reads as a feature and does nothing is worse than its absence.

## What the environment forced

Two things did not work the way the plan assumed. Both were found by running the code, not by reading it.

**Bun's `ipc` option does not work on Windows.** The child gets a `process.send` that is a function and a channel
that never connects:

```
warn: Unable to start IPC pipe '3[libuv]'
```

The parent then waits out its step timeout with nothing on stdout to explain it. The transport is now
newline-delimited JSON over stdio, which works everywhere — and turned out better twice over:

- **The protocol owns the child's stdout**, so `console` is redirected to stderr before any kit is loaded. "A kit
  must not write to stdout" is now enforced by the process rather than remembered by a person, and a kit's stray
  `console.log` lands in stderr where the parent reads and logs it.
- **Messages are JSON, not structured clones.** That is the right fidelity rather than a loss: a step's input and
  output go into `jsonb` columns, so anything JSON cannot carry could not have been stored anyway.

**`Bun.fileURLToPath`, not `.pathname`.** On Windows a file URL's pathname is `/G:/…` — the leading slash is not
part of any real path, so `bun` could not find the child entry and the failure was invisible behind a piped stderr.

One more platform behaviour, deliberately *not* worked around: `Bun.spawn` with piped stdio keeps a Bun process
alive after the child is killed and reaped. Confirmed with a bare spawn/kill/await, so it is not ours to fix. It
does not affect the worker, which is a daemon whose shutdown handler already exits explicitly — it only matters for
one-shot scripts, which now exit explicitly.

## What is and is not sandboxed

Worth stating precisely, because the gap between this and "sandboxed" is where a false sense of safety lives.

**Enforced:** a wall-clock cap on the run (`timeout` + `killSignal`), a wall-clock cap on each step (a race that
kills the child on overrun), an output cap (`maxBuffer`), and an allowlisted `env` so `DATABASE_URL` and
`SECRETS_KEY` are not present to be read. Kits reach the network only through the guarded client.

**Not enforced, because Bun's spawn options do not provide it:** memory, CPU, filesystem or network isolation. A
memory ceiling is a container concern — `--memory`, or a cgroup — and is documented as such rather than pretended
to. `uid`/`gid` would drop privileges but are POSIX-only and fail outright on Windows, so they are unused.

## The address guard, and two bypasses it had

`ssrf-guard.ts` refuses loopback, link-local, the private ranges, and anything but HTTP and HTTPS — checked at
*every* redirect hop, because a permitted URL that redirects to `169.254.169.254` is the same attack with one more
step. This matters more than it might read: an HTTP step's URL can come from a flow's **data**, so
`{{body.callbackUrl}}` means whoever sends the webhook chooses where the worker connects.

Writing the tests found two real holes:

1. **IPv4-mapped IPv6 addresses slipped through.** `URL` normalises `[::ffff:169.254.169.254]` to
   `[::ffff:a9fe:a9fe]`, so matching only the dotted spelling let a mapped address reach the metadata service. Both
   spellings are now decoded.
2. **`ENGINE_ALLOW_PRIVATE_NETWORK` could never take effect for loopback**, because `localhost` was in the
   always-refused list *and* in the flag-aware branch. `blockedHostnames` now holds only what is refused
   unconditionally — metadata endpoints — and link-local stays refused whatever the flag says.

## Also in this change

- **The connection picker.** The inspector said a Gmail step needed a connection and gave no way to choose one. It
  now shows the workspace's connections for that kit, labelled by *account* rather than only by name, because two
  Gmail connections differ by mailbox. **A single candidate is selected without asking**, at the moment the step is
  created — making somebody pick from a list of one teaches them nothing and can only be got wrong by leaving it
  blank. Deciding it when the panel opens would mean looking at a node changed the flow.
- **The page no longer scrolls when a panel should.** The app shell was `min-h-dvh`, which grows with its content
  and makes the *document* the scroll container — so revealing a form field at the bottom of the inspector dragged
  the header and the canvas off-screen. It is now `h-dvh overflow-hidden`, with `min-h-0` on every flex ancestor
  between it and each scroll container. That second part is not decoration: a flex child defaults to
  `min-height: auto` and refuses to shrink below its content, so a descendant's `overflow-y-auto` has nothing to
  overflow within and silently does nothing. **Added to CLAUDE.md as a rule**, with both mistakes named.
- **Thin scrollbars**, in the app's palette. The platform default is a ~15px slab painted by the OS, so on this
  dark theme it arrives light — the same problem a native `<select>` has, for the same reason. Declared twice
  because no single property covers both engines: `scrollbar-width`/`scrollbar-color`, and the
  `::-webkit-scrollbar` pseudo-elements.
- **`{{steps.…}}` is keyed by a slug of the step's name**, not the name itself. A name is free text: "Look up the
  order" has spaces the path grammar does not admit, and "Total (2.5)" has a dot that would split the path in the
  wrong place and resolve to nothing. `lookUpTheOrder` is closed over the safe alphabet by construction. Colliding
  slugs are suffixed deterministically, so one step cannot shadow another's output.
- The worker reads `AUTH_SECRET`, `SECRETS_KEY`, `AUTH_BASE_URL` and the connector pairs — **the same values as the
  API, not copies.** Given different ones it would refresh no token and decrypt no secret.

## Action required

**New environment variable: `ENGINE_ALLOW_PRIVATE_NETWORK`** (default `false`). Leave it alone unless the
deployment genuinely automates against a service on its own network; read the note in `.env.example` first.

**The worker now needs `AUTH_SECRET`, `SECRETS_KEY` and `AUTH_BASE_URL`** — the same values the API has. Both
compose files pass them; a hand-rolled deployment must too, or the worker will refuse to start. That is deliberate:
starting up and failing to resolve a credential mid-run would be worse.

No migration beyond the one from the run-persistence change.

## Verification

`bun test` — 442 across the repo, 40 of them new in `apps/worker/tests`: the address guard (both bypasses have
regression tests), template resolution and coercion, the step-name slug and its collision handling, and the
execution order for a chain, a branch, a diamond and an unconnected step.

**Then run against the real stack, which is where the two platform problems and both SSRF holes were found.** A
script built four flows and executed them through the real subprocess against a real Postgres and a real local HTTP
server:

- `trigger → http.request → core.log` succeeded, both steps journalled in wired order, the HTTP step returned 200
  with its parsed body in the journal, and `core.log` received
  `"Order A-1024 returned 200"` — a variable from the trigger *and* one from the earlier step's output, in one
  field.
- A step pointed at `169.254.169.254` failed with `is a link-local address`, **with
  `ENGINE_ALLOW_PRIVATE_NETWORK` on**; the step after it was journalled `skipped`.
- A step marked `continueOnFailure` failed, the next step ran, and the run's own outcome was still `failed` — a run
  with a failed step did not fully succeed, whatever it was told to do next.
- Re-running the same attempt wrote no second step-run row and left the recorded output unchanged: the replay that
  stops the second email.

`bun run typecheck` (8 packages), `bun run check` and `bun run config:check` clean.
