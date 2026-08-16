/**
 * Queries against the accounts Better-Auth owns.
 *
 * Read-only, and deliberately narrow: Better-Auth writes these rows and refreshes the tokens in
 * them. This exists so a connection can point at one, without anything here touching the token
 * columns — reading a token goes through `auth.api.getAccessToken`, which refreshes an expired one
 * instead of handing back a stale value.
 */

import { and, desc, eq } from "drizzle-orm";
import { account } from "./auth-schema";
import type { Database } from "./client";

export type LinkedAccount = {
  /** The provider's own id for the account, which `getAccessToken` needs to disambiguate. */
  accountId: string;
  scope: string | null;
};

/**
 * The account most recently linked for this provider.
 *
 * Newest first, because a user may connect several accounts of the same service — a personal
 * mailbox and a shared one — and each returns here immediately after authorising. Taking an
 * arbitrary row would record the second connection against the first account.
 */
export async function findLinkedAccountForUser(
  db: Database,
  userId: string,
  providerId: string,
): Promise<LinkedAccount | undefined> {
  const rows = await db
    .select({ accountId: account.accountId, scope: account.scope })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(desc(account.createdAt))
    .limit(1);

  return rows[0];
}
