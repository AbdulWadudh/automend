/**
 * The operator grant.
 *
 * Everything the queue dashboard's security rests on is here rather than in the dashboard: the cookie
 * is unforgeable, it dies when the password is rotated, and it expires on its own contents rather than
 * on an attribute the client is free to discard.
 *
 * The cookie is minted and read through real Hono requests, not by inspecting internals. A test that
 * built the cookie itself would keep passing while the signing was broken, which is the one failure
 * that matters.
 */

import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { Hono } from "hono";
import { createOpsSession, type OpsSession } from "../../src/http/ops-session";

const { cookieName, maxAgeSeconds } = config.ops.queueDashboard.session;

const PASSWORD = "the-operator-password";
const SIGNING_SECRET = "s".repeat(config.auth.secretMinLength);

function session(overrides: { password?: string; signingSecret?: string; secureCookie?: boolean } = {}): OpsSession {
  return createOpsSession({
    password: overrides.password ?? PASSWORD,
    signingSecret: overrides.signingSecret ?? SIGNING_SECRET,
    secureCookie: overrides.secureCookie ?? false,
  });
}

/** The full `Set-Cookie` header a grant produces, attributes included. */
async function setCookieHeader(target: OpsSession): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => {
    await target.grant(c);
    return c.body(null, 204);
  });

  return (await app.request("/")).headers.get("set-cookie") ?? "";
}

/** Just the `name=value` pair, which is what a browser sends back. */
async function grantedCookie(target: OpsSession): Promise<string> {
  return (await setCookieHeader(target)).split(";")[0] ?? "";
}

/** Whether `target` accepts `cookie` — asked of a real request, the way the guard asks. */
async function accepts(target: OpsSession, cookie: string): Promise<boolean> {
  const app = new Hono();
  app.get("/", async (c) => c.json({ granted: await target.isGranted(c) }));

  const response = await app.request("/", { headers: { Cookie: cookie } });
  const body = (await response.json()) as { granted: boolean };

  return body.granted;
}

describe("checking the operator password", () => {
  test("accepts the configured password", () => {
    expect(session().matchesPassword(PASSWORD)).toBe(true);
  });

  test("rejects a wrong password of the same length", () => {
    expect(session().matchesPassword("x".repeat(PASSWORD.length))).toBe(false);
  });

  test("rejects passwords of a different length rather than throwing", () => {
    // The reason both sides are hashed before comparison: `timingSafeEqual` throws on a length
    // mismatch, so a shorter guess would be a 500 instead of a refusal — and which error you got would
    // leak the length.
    const guard = session();

    expect(guard.matchesPassword("short")).toBe(false);
    expect(guard.matchesPassword(`${PASSWORD}-and-then-some-more`)).toBe(false);
    expect(guard.matchesPassword("")).toBe(false);
  });
});

describe("the cookie a grant issues", () => {
  test("is HttpOnly, so no script can read or copy it", async () => {
    expect(await setCookieHeader(session())).toContain("HttpOnly");
  });

  test("is scoped to the whole origin, because two prefixes read it", async () => {
    // The versioned API issues it; `/ops/queues` reads it. Scoped to either one, the other never sees it.
    expect(await setCookieHeader(session())).toContain("Path=/");
  });

  test("is SameSite=Lax, which allows the top-level navigation into the dashboard", async () => {
    expect(await setCookieHeader(session())).toContain("SameSite=Lax");
  });

  test("carries the configured lifetime", async () => {
    expect(await setCookieHeader(session())).toContain(`Max-Age=${maxAgeSeconds}`);
  });

  test("is Secure only where the browser reaches the deployment over HTTPS", async () => {
    // Not from NODE_ENV: a Secure cookie on a plain-http laptop is silently never sent, which looks
    // exactly like a password that was rejected.
    expect(await setCookieHeader(session({ secureCookie: true }))).toContain("Secure");
    expect(await setCookieHeader(session({ secureCookie: false }))).not.toContain("Secure");
  });
});

describe("reading a grant back", () => {
  test("accepts the cookie it just issued", async () => {
    const guard = session();

    expect(await accepts(guard, await grantedCookie(guard))).toBe(true);
  });

  test("refuses a request with no cookie", async () => {
    expect(await accepts(session(), "")).toBe(false);
  });

  test("refuses an unsigned value, however plausible", async () => {
    expect(await accepts(session(), `${cookieName}=${Date.now()}`)).toBe(false);
  });

  test("refuses a cookie whose value was edited after signing", async () => {
    const guard = session();
    const cookie = await grantedCookie(guard);

    expect(await accepts(guard, `${cookie}0`)).toBe(false);
  });

  test("refuses a grant issued under the previous password", async () => {
    // This is why the password is mixed into the signing key. Signed with the deployment secret alone,
    // rotating the password would leave every grant already handed out working.
    const cookie = await grantedCookie(session({ password: "the-old-password" }));

    expect(await accepts(session(), cookie)).toBe(false);
  });

  test("refuses a grant issued under a different deployment secret", async () => {
    const cookie = await grantedCookie(session({ signingSecret: "d".repeat(config.auth.secretMinLength) }));

    expect(await accepts(session(), cookie)).toBe(false);
  });

  test("refuses a grant older than the configured lifetime, whatever Max-Age said", async () => {
    // The age that counts is the one *inside* the signed value. `Max-Age` is an instruction to the
    // client, and a client that keeps the cookie anyway must not thereby keep the grant.
    const guard = session();

    // Signed by the real signer, so only the timestamp is old — which is exactly the attack.
    const signedRecently = await grantedCookie(guard);
    expect(await accepts(guard, signedRecently)).toBe(true);

    const expired = await grantedCookieIssuedAt(guard, Date.now() - (maxAgeSeconds + 60) * 1_000);
    expect(await accepts(guard, expired)).toBe(false);
  });

  test("refuses a grant stamped in the future, rather than treating it as fresh", async () => {
    // A clock that moved is not evidence of a recent sign-in.
    const guard = session();
    const cookie = await grantedCookieIssuedAt(guard, Date.now() + 60 * 60 * 1_000);

    expect(await accepts(guard, cookie)).toBe(false);
  });
});

/**
 * A correctly signed grant bearing an arbitrary issue time.
 *
 * Obtained by moving `Date.now` for the duration of the grant rather than by signing by hand, so the
 * signature is produced by the code under test and only the timestamp is contrived.
 */
async function grantedCookieIssuedAt(target: OpsSession, issuedAt: number): Promise<string> {
  const realNow = Date.now;
  Date.now = () => issuedAt;

  try {
    return await grantedCookie(target);
  } finally {
    Date.now = realNow;
  }
}
