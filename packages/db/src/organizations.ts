/**
 * Workspace membership queries.
 *
 * A workspace (a Better-Auth organization) is the tenant every other table is scoped by, so these
 * answer one question: which workspaces may this user act in?
 */

import { and, asc, eq } from "drizzle-orm";
import { member, organization } from "./auth-schema";
import type { Database } from "./client";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

/**
 * The workspace a session falls back to when it carries no active one — the first the user joined,
 * which for a personal account is the one created with it.
 */
export async function findOldestOrganizationIdForUser(db: Database, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return rows[0]?.organizationId;
}

export async function listWorkspacesForUser(db: Database, userId: string): Promise<WorkspaceSummary[]> {
  return await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
}

/**
 * Whether the user may act in this workspace.
 *
 * Called before anything tenant-scoped is read or written, because the workspace id on a session
 * is only as trustworthy as the membership behind it — a user can be removed from a workspace
 * while holding a session that still names it.
 */
export async function isMemberOfOrganization(db: Database, userId: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  return rows.length > 0;
}
