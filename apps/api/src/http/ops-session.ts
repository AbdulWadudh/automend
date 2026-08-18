/**
 * The operator password, and the short-lived cookie that remembers it was accepted.
 *
 * **Why a cookie rather than HTTP Basic.** Basic auth is answered by the *browser's* own credential
 * dialog: an operating-system box drawn over a themed product, which no stylesheet can reach, which
 * cannot say what is being asked for or what it grants, and which offers nothing when you get it
 * wrong. So the password is presented on a real page in the app, exchanged here for a cookie, and the
 * queue dashboard checks the cookie.
 *
 * Three properties of that cookie are the whole security of it:
 *
 * - **Signed, so it cannot be forged.** Nothing about it is secret — its value is a timestamp — but
 *   the signature is what makes it unforgeable.
 * - **Signed with the password mixed into the key.** Rotating the operator password therefore
 *   invalidates every grant already issued, which is the point of rotating it. Signing with the
 *   deployment secret alone would leave yesterday's grants working.
 * - **Checked against its own issue time**, not only against `Max-Age`. A cookie is data the client
 *   holds, so its expiry is the client's to discard; the age that matters is the one inside the
 *   signed value.
 *
 * The password is taken as an argument rather than read from the environment here, so the routes above
 * are constructed with it and a test can supply its own.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@automend/shared";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

const { cookieName, maxAgeSeconds } = config.ops.queueDashboard.session;

export type CreateOpsSessionOptions = {
  /** The operator password this deployment configured. */
  password: string;
  /** The deployment's signing secret. Combined with the password to key the cookie's signature. */
  signingSecret: string;
  /**
   * Whether the browser reaches this deployment over HTTPS.
   *
   * Decided by the caller from the *browser's* own origin rather than from `NODE_ENV`, because that is
   * the connection the cookie travels over. A `Secure` cookie on a plain-http laptop is silently never
   * sent, which looks exactly like a password that was rejected.
   */
  secureCookie: boolean;
};

export type OpsSession = {
  /** Whether `candidate` is the configured operator password, compared in constant time. */
  matchesPassword: (candidate: string) => boolean;
  grant: (c: Context) => Promise<void>;
  clear: (c: Context) => void;
  /** Whether this request carries an unexpired grant. */
  isGranted: (c: Context) => Promise<boolean>;
};

/**
 * Constant-time comparison of two secrets of *unknown* length.
 *
 * `timingSafeEqual` throws on a length mismatch, so comparing the raw strings would both crash on the
 * common failure and leak the password's length through which failure you got. Digesting first makes
 * both sides a fixed 32 bytes, and a SHA-256 collision is not an attack anybody has.
 */
function secretsMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function createOpsSession({ password, signingSecret, secureCookie }: CreateOpsSessionOptions): OpsSession {
  // The password is part of the key, so rotating it invalidates every cookie already handed out.
  const signingKey = `${signingSecret}:${password}`;

  return {
    matchesPassword: (candidate) => secretsMatch(candidate, password),

    grant: async (c) => {
      await setSignedCookie(c, cookieName, String(Date.now()), signingKey, {
        httpOnly: true,
        secure: secureCookie,
        // Lax rather than Strict: reaching the dashboard is a top-level navigation from the app, which
        // Lax allows, while still refusing the cookie on a cross-site subresource or form post.
        sameSite: "Lax",
        // Read by two different prefixes — the versioned API and `/ops` — so it cannot be scoped to
        // either one of them.
        path: "/",
        maxAge: maxAgeSeconds,
      });
    },

    clear: (c) => {
      deleteCookie(c, cookieName, { path: "/" });
    },

    /**
     * A tampered or wrongly-signed cookie reads the same as no cookie: there is nothing useful to tell
     * the caller apart from "present the password", and saying more would confirm a guess.
     */
    isGranted: async (c) => {
      // `false` for a bad signature, `undefined` for no cookie at all — neither is a grant.
      const value = await getSignedCookie(c, signingKey, cookieName);

      if (typeof value !== "string") {
        return false;
      }

      const issuedAt = Number(value);

      if (!Number.isFinite(issuedAt)) {
        return false;
      }

      const ageSeconds = (Date.now() - issuedAt) / 1_000;

      // A negative age means a clock moved, not that the grant is fresh — treated as expired.
      return ageSeconds >= 0 && ageSeconds < maxAgeSeconds;
    },
  };
}
