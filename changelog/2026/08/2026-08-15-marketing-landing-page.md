# Landing page, legal pages, and the status page moved to /status

- **Date:** 2026-08-15
- **Type:** feat
- **Scope:** `apps/web`, `packages/shared`

## Summary

`/` is now a marketing landing page for Automend. The dependency health report that used to live
there moved to `/status`, unchanged. Two legal pages were added at `/privacy` and `/tos`, and the
root layout became a real site shell with a sticky header, a footer and a skip link.

## Why

The web app's home route was a bootstrap probe — proof the browser could reach the API through the
proxy. That is a useful page, but it is not what belongs at the address people are given. It moved
to `/status`, which is also where a link in the footer and the header now points.

`/privacy` and `/tos` are needed before anything external can be wired up: OAuth providers, app
directories and payment processors all require both URLs to exist and to be reachable without
authentication. Writing them now, while the data model is small enough to describe honestly, is
much easier than reconstructing what the software touches after the fact.

The landing copy is deliberately specific about the project being early access, because it is. The
FAQ says outright that flow execution, auth and the canvas are not built yet — a landing page that
implies otherwise costs more in wasted evaluations than it wins in signups.

## What changed

- **`packages/shared/src/config.ts`** gained two blocks:
  - `webClient.routes` — every path the web app answers on, plus `webClient.landingSections` for
    the deep-linkable anchors. Everything that *links* to a page reads from here. `createFileRoute()`
    still takes a literal, because the router plugin derives the tree from the file name and cannot
    resolve a value from config.
  - `company` — product name, public domain, repository URL, contact addresses and the legal
    effective date. The three contact addresses are *derived* from one `PUBLIC_DOMAIN` primitive, so
    registering the real domain is a one-line change. Identity values only; prose stays in the
    components that render it.
- **`apps/web/src/routes/__root.tsx`** is now a shell — skip link, `SiteHeader`, `main`,
  `SiteFooter` — and no longer imposes a `max-w-4xl` container. Each page sets its own width, which
  is what lets the landing page run full-bleed.
- **New components**, split by section rather than kept in one route file: `components/site/` for
  the header and footer, `components/landing/` for the six landing sections, and
  `components/legal/legal-page.tsx`, a data-driven layout both legal pages render through — they
  supply an array of sections and share the heading, table of contents and effective-date rendering.
- **`apps/web/src/styles.css`** adds `--brand` (green, tuned separately per theme so both meet 4.5:1
  against their own background), a `bg-grid` utility for the hero, `scroll-padding-top` so anchors
  clear the sticky header, and a `prefers-reduced-motion` block.
- **Tests** in `packages/shared/tests/config.test.ts` assert the new invariants: routes are absolute
  and distinct, no page route collides with a prefix `server.ts` proxies away before the SPA sees it,
  anchors are bare fragment identifiers, and every contact address derives from the one domain.
- **`CLAUDE.md`** gained a coding-standards rule: do not comment code that does the expected thing.
  A comment is earned by a workaround, an external constraint, a deliberate deviation or a
  placeholder — not by narrating what the code already says.

## Action required

**Two values in `config.ts` still need attention before this is public:**

| Value | Current | Needed |
|---|---|---|
| `company.legal.governingLaw` | `England and Wales` | The jurisdiction the entity is actually registered in. |
| `company.legal.effectiveDate` | `2026-08-15` | Bump whenever either legal document is edited. |

`company.domain` is set to `automend.k79.quest`, and the `support@`, `privacy@` and `security@`
addresses on the legal pages derive from it — **those three mailboxes have to actually receive
mail**, because the privacy policy commits us to answering rights requests at them.

**The legal pages are drafts, not reviewed advice.** They describe this architecture accurately —
self-hosted, no data reaching the project, credentials encrypted at rest — but a lawyer should read
both before they are relied on, particularly the liability cap and the governing-law clause.

Two further follow-ups, deliberately left out rather than faked:

- No Open Graph image. `og:image` and `og:url` need an absolute URL, and baking a placeholder domain
  into `index.html` is worse than omitting the tags — `index.html` is static and cannot read config.
  Add a 1200×630 image and both tags once the domain is real.
- No `sitemap.xml` or `robots.txt`, for the same reason.

No environment variables, no migrations, no API changes.

## Verification

- `bun test packages/shared/tests/config.test.ts` — 25 pass, including the 6 new assertions.
- `bun run --cwd apps/web typecheck` — clean.
- `bun run --cwd apps/web build` — succeeds. The router plugin regenerated `routeTree.gen.ts` with
  all four routes, and each page code-split into its own chunk.
- `bunx biome check apps/web packages/shared` — clean.
- Deep links work in production because `server.ts` already falls through to `index.html` for any
  path that is not a real file; the new `config.test.ts` case guards the one way that could break
  (a page route shadowed by a proxied prefix).
