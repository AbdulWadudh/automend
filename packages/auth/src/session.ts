/**
 * Turning an incoming request into the two facts every tenant-scoped handler needs: who is asking,
 * and which workspace they are asking about.
 *
 * The workspace on a session is a *hint*, not an authorisation. A user can be removed from a
 * workspace while still holding a session that names it, so membership is confirmed here before
 * the id is handed to anything that queries by `tenant_id`.
 */

import type { Database } from "@automend/db";
import { findOldestOrganizationIdForUser, isMemberOfOrganization } from "@automend/db";
import type { Auth } from "./auth";
import { buildPersonalWorkspaceName, buildWorkspaceSlug } from "./workspace";

export type AuthenticatedRequestContext = {
  userId: string;
  /** The workspace every query in this request is scoped by. */
  tenantId: string;
};

export type ResolveRequestContextOptions = {
  auth: Auth;
  db: Database;
  headers: Headers;
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
};

/**
 * Recreates the workspace that sign-up should have created.
 *
 * Reached when the sign-up hook failed, or when a user has been removed from every workspace they
 * belonged to. Either way they cannot store a flow without one, so it is made on the spot rather
 * than answering an error the user has no way to act on.
 */
async function createWorkspaceFor(auth: Auth, user: SessionUser): Promise<string | undefined> {
  const created = await auth.api.createOrganization({
    body: {
      name: buildPersonalWorkspaceName(user.name),
      slug: buildWorkspaceSlug(user.name || user.email),
      userId: user.id,
    },
  });

  return created?.id;
}

/**
 * The organization plugin writes `activeOrganizationId` onto the session row, but that field does
 * not reach the type `getSession` returns, so it is read as the untrusted value it is: whatever is
 * in the column, confirmed against the membership table before it is used.
 */
function readActiveOrganizationId(session: object): string | undefined {
  const value = (session as { activeOrganizationId?: unknown }).activeOrganizationId;

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function resolveRequestContext({
  auth,
  db,
  headers,
}: ResolveRequestContextOptions): Promise<AuthenticatedRequestContext | undefined> {
  const session = await auth.api.getSession({ headers });

  if (!session) {
    return undefined;
  }

  const { user } = session;
  const claimedTenantId = readActiveOrganizationId(session.session);

  if (claimedTenantId && (await isMemberOfOrganization(db, user.id, claimedTenantId))) {
    return { userId: user.id, tenantId: claimedTenantId };
  }

  const fallbackTenantId =
    (await findOldestOrganizationIdForUser(db, user.id)) ?? (await createWorkspaceFor(auth, user));

  if (!fallbackTenantId) {
    return undefined;
  }

  return { userId: user.id, tenantId: fallbackTenantId };
}
