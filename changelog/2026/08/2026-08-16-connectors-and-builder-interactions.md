# Connectors, and a builder you can drive from the keyboard

- **Date:** 2026-08-16
- **Type:** feat
- **Scope:** `packages/shared`, `packages/db`, `packages/auth`, `api`, `web`

## Summary

Dragging a connection off a node and letting go on empty canvas now opens a menu of steps and
creates the one you pick, already wired up — which is also how a flow gets parallel branches. The
builder has keyboard shortcuts and nodes are coloured by what they do. Separately, `/app/connections`
is a new dashboard for the credentials flows will act through: Slack, Google and Discord over OAuth,
plus API tokens for anything else.

## Why

**A dropped connection is a question, not a mistake.** Releasing a line over empty canvas is the
author saying "something happens after this" without saying what. Snapping the line away and making
them find the palette, add a node, drag it into place and connect it turns one gesture into four.
The menu opens where they let go, and the node arrives connected and selected.

**Connector tokens are not session tokens.** They protect different things for different lifetimes,
so `SECRETS_KEY` is separate from `AUTH_SECRET`: rotating a session key must not make every stored
API token unreadable. Tokens are envelope-encrypted — a single-use data key per secret, itself
sealed with the master key — so the master key only ever encrypts small high-entropy values, and
rotating it means re-sealing one data key per secret without decrypting the secrets themselves.
AES-256-GCM throughout, so a row edited in the database fails to decrypt rather than decrypting to
something else.

**Connecting a service is not signing in with it.** "Sign in with Google" asks who you are;
connecting Google asks to send mail as you. They are registered as separate providers —
`google` and `google-connector` — so the login button cannot quietly carry automation scopes, and
disconnecting a service does not sign anyone out. Same OAuth application, two registrations.

**A connection belongs to the workspace, not to the person who made it.** A flow posting to Slack
has to keep working after that person leaves, so `connections` is tenant-scoped like `flows`, and
deleting a connection removes the workspace's authorisation without touching the underlying account
— which the same person may have connected to another workspace.

## What changed

- **Canvas**: `onConnectEnd` opens a step picker anchored where the pointer was released;
  `addStep` now takes an explicit position and source, so the choice is the author's rather than
  inferred. Nodes and edges are coloured per kind from six accents defined as CSS tokens — an edge
  takes the colour of the node it leaves, so a branch is followable by eye. Colour is never the
  only signal: each node also carries its kind as text for screen readers.
- **Shortcuts**: save, duplicate, delete, clear selection, and `?` for the list — with a visible
  button so they are discoverable. `lib/keyboard.ts` holds the two rules worth testing: never
  hijack a keystroke aimed at a field, and treat Cmd on a Mac as Ctrl elsewhere (accepting either
  would fire Ctrl+S on a Mac, which nobody there expects).
- **`packages/shared/src/crypto.ts`** (new, server-only subpath): envelope encryption, plus
  `secretHint` for showing which token is stored without revealing it.
- **`connections` table** and its queries. `findConnectionSecret` is the only query that reads
  secret material, so "what can reach a stored token" is answered by finding its callers.
- **`/api/v1/connections`**: catalogue, list, create-from-token, record-after-OAuth, rename,
  replace-token, delete. Credentials expire and keys get rotated, so a connection can be renewed
  without being removed and rebuilt — a token connection takes a replacement secret, and an OAuth
  one re-runs its authorisation and refreshes in place through the same upsert. Replacing a secret
  is scoped to `kind = 'token'` in the query itself, so an OAuth row cannot end up claiming to hold
  a secret whose real credentials live in Better-Auth. The OAuth path looks the account up rather than trusting the body, so naming a provider
  you never authorised creates nothing.
- **`bun run dev:up` now checks `.env` against `.env.example`.** Adding a required variable used to
  present terribly: the apps read their environment once at startup, so a running `bun --hot`
  process keeps serving the last module graph that loaded, and the symptom is a 404 for a route
  that plainly exists in the source — with the real error only in a terminal nobody is watching.
  This caught it twice while building connectors, so the check names the missing variables up
  front and says that a running dev server must be restarted to pick them up.

## Action required

- **Set `SECRETS_KEY`** — base64 of exactly 32 bytes, no default; the API refuses to start without
  it. `openssl rand -base64 32`. Losing it makes every stored connector token unrecoverable.
- **Run the migrations**: `bun run db:migrate` (`0002`–`0004`). The last is a data migration that
  renames existing connections from the address to the account holder, and only where the name is
  exactly the stored address — the signature of the old default. A name someone chose is untouched.
- Slack and Discord connectors are optional and off until their credentials are set. Their redirect
  URIs are `<AUTH_BASE_URL>/api/v1/auth/oauth2/callback/<provider>-connector` — note the
  `-connector` suffix, which is what keeps them distinct from sign-in.

## Verification

- `bun test` (131): envelope encryption round-trips, rejects a wrong key, a tampered ciphertext, a
  tampered tag, a swapped data key and an unknown version; never produces the same ciphertext twice
  for the same input, and never reveals which check failed. Plus the picker's wiring, duplication
  limits, and the keyboard rules.
- Stored an API token over HTTP and read the row directly out of Postgres: the value is an envelope,
  and `select … where encrypted_secret::text like '%<the token>%'` returns zero rows. The listing
  response contains only `••••efgh`.
- Tenant isolation: a second workspace sees an empty list and gets 404 deleting the first
  workspace's connection, which survives.
- Guards: recording an OAuth connection for a provider the user never linked is refused, as is
  recording a token provider as OAuth.

## Recording a connection is idempotent

The browser posts to `/connections/oauth` after returning from the provider, and that can happen
more than once for a single authorisation — React's development mode double-invokes the effect, a
refresh of the callback URL repeats it, a retry repeats it. An insert failed the second time on the
unique index and surfaced as "Internal server error" *beside a connection that had in fact been
made*, which is the worst of both: an alarming message and a successful outcome.

It is an upsert now, keyed on the same `(tenant, provider, account)` index. Repeating the request
returns the existing row. The conflict refreshes the scopes and the timestamp but deliberately
leaves `display_name` alone — re-authorising a service must not undo the name someone gave it.

## A connection says whose account it is

`111453116590250494252` identifies a Google account precisely and tells a human nothing. The
provider's own id is now the last resort rather than the first thing shown: when a connection is
recorded, the API asks the provider who the account belongs to and stores the name and address on
the row. The connection takes the account holder's name, and the line beneath it carries the
address — which is what tells two accounts belonging to the same person apart.

It is copied rather than fetched per listing, because a list of a workspace's connections should
not depend on three upstream services being reachable — and it is refreshed whenever the connection
is re-authorised. The lookup goes through `auth.api.accountInfo`, which is the same
token-and-refresh path the execution engine will use, so this exercises it now rather than
discovering later that connector tokens were never reachable that way. A failure to reach the
provider leaves the labels empty and the connection intact: authorising a service is what makes it
connected, not our ability to put a name on it.

## Several accounts of the same service

A workspace can connect a service more than once: a personal mailbox and a shared one are different
accounts. The unique index was already scoped to the account rather than the provider, so the
storage allowed it, but two things did not:

- `findLinkedAccountForUser` returned an arbitrary row, so connecting a second Google account
  recorded it against the first. It now takes the most recently linked one.
- Both connections defaulted to the name "Google" and were indistinguishable in the list. A second
  one is named "Google 2", and connections can now be renamed from the dashboard — only the person
  connecting it knows whether it is the billing mailbox or the support one.

## What an OAuth connector must declare

Better-Auth's callback resolves an **email, an id and a name** from the provider before it stores
anything — even when linking to an account that already exists. A connector configured with only
an authorization and token URL therefore gets as far as exchanging the code and then fails the
redirect with `user_info_is_missing`. Every OAuth connector must name a `userInfoUrl` and request
identity scopes alongside whatever it needs for its actual job, and where a provider spells those
fields differently (Discord returns `username`, not `name`) it needs a `mapProfileToUser`.

It must also ask for the account chooser, and for a refresh token. Google skips its chooser when
the browser already has a session, silently connecting whoever happens to be signed in — rarely the
mailbox someone meant to connect — so the Google connector sends `prompt=select_account consent`.
The `consent` half is not redundant: Google issues a refresh token only on a first authorisation
unless consent is re-requested, and `access_type=offline` is what makes it issue one at all.
Without both, a connection stops working an hour later with nothing able to renew it — a failure
that would have surfaced only once the execution engine tried to use it.

`account.accountLinking.allowDifferentEmails` is on for the same reason: a connected service rarely
shares an address with the person connecting it — a shared `ops@` mailbox is the normal case — and
without it every such connection fails with `email_doesn't_match`. Linking only ever happens from
inside an authenticated session, so it can attach an account to the signed-in user and nobody else;
the dangerous direction, *signing in* and being matched to an existing account by an unverified
email, is governed separately by `trustedProviders`.

## Reading a stored token back

`POST /connections/:id/reveal` returns a token in the clear — the only response in the system that
does. It exists because a self-hosted deployment is the only copy of the value: someone who stored
a key and lost it has nowhere else to look.

The cost is real and should be stated rather than buried: any valid session for the workspace can
read every credential the workspace owns. What that bought in shape:

- A POST, so the value is never produced by a link, a prefetch, or a URL left in browser history
  and proxy logs.
- `no-store`, so nothing caches it after the response is read.
- An audit line naming who revealed which connection — verified to contain no token.
- Shown in a popover anchored to its own button, and closing forgets the value rather than covering
  it — so the token is in the page only while it is on screen, and reopening is another audited
  request. Inline would also have grown the row and displaced every control beside it, which is a
  poor trade for text you are about to copy and dismiss.

**Not** built, and the obvious next step: requiring the password again before revealing. Until then
this is exactly as strong as a session cookie.

## Known gaps

- **Slack connects but cannot post yet.** Slack's OpenID Connect endpoints identify an account,
  which is what makes a connection storable; its v2 app-install flow is what returns a bot token
  for `chat:write`, and that flow has no user-info endpoint to satisfy the callback with. The two
  cannot be combined in one request, so the connector currently offers identity only. Promising
  `chat:write` in the catalogue would have produced a connector that failed the moment a flow used
  it. A proper install flow is its own change.

- **Nothing consumes a connection yet.** Steps cannot reference one, and the worker does not fetch
  tokens — `auth.api.getAccessToken` is reachable from `packages/auth` by design, but wiring it into
  step execution is the execution-engine change.
- The OAuth *connect* flow is verified as far as the authorization request; completing a round trip
  needs real Slack and Discord credentials, which this deployment does not have. The Google path
  shares the same code.
- Renaming a connection has an API endpoint but no UI yet.
