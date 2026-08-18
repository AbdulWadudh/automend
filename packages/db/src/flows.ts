/**
 * Flow queries.
 *
 * Every function here takes `tenantId` as a required argument and applies it to the `where` clause, including
 * the ones that already have a primary key. That is deliberate: a flow id is a UUID a caller could have
 * obtained anywhere, and scoping by tenant is what turns "not yours" into "not found" rather than into a leak.
 *
 * Every *read* also passes its definition through `upgradeFlowDefinition`, so the invariant "a flow read from
 * the database has a current definition" holds in one place rather than at each of a dozen call sites. That is
 * what makes this module depend on `@automend/kits`: the version mapping names kits, so it cannot live in
 * `@automend/shared`. Rows are not rewritten on read — an upgrade is applied in memory and persisted only when
 * the flow is next saved, so reading a flow never needs a write transaction.
 */

import { upgradeFlowDefinition } from "@automend/kits";
import type { FlowDefinition } from "@automend/shared";
import { and, desc, eq, ilike } from "drizzle-orm";
import type { Database } from "./client";
import { type FlowRow, flows } from "./schema";

/**
 * A stored row with its definition brought up to date.
 *
 * Throws when a definition cannot be read at all, which is deliberate: executing or displaying half of
 * somebody's flow is worse than refusing to, and the API turns this into a validation error naming the flow.
 */
function withCurrentDefinition(row: FlowRow): FlowRow {
  return { ...row, definition: upgradeFlowDefinition(row.definition) };
}

export type InsertFlowValues = {
  tenantId: string;
  name: string;
  description?: string | null;
  definition: FlowDefinition;
  createdBy: string | null;
};

export type UpdateFlowValues = {
  name?: string;
  description?: string | null;
  definition?: FlowDefinition;
};

export type ListFlowsOptions = {
  /** Matched against the name, case-insensitively, anywhere in it. */
  search?: string;
  limit?: number;
};

/** `%` and `_` are wildcards to `ilike`, so a name containing either must not silently match more. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function listFlowsForTenant(
  db: Database,
  tenantId: string,
  options: ListFlowsOptions = {},
): Promise<FlowRow[]> {
  const conditions = [eq(flows.tenantId, tenantId)];

  if (options.search) {
    conditions.push(ilike(flows.name, `%${escapeLikePattern(options.search)}%`));
  }

  const query = db
    .select()
    .from(flows)
    .where(and(...conditions))
    .orderBy(desc(flows.updatedAt));

  const rows = await (options.limit === undefined ? query : query.limit(options.limit));

  return rows.map(withCurrentDefinition);
}

export async function findFlowForTenant(db: Database, tenantId: string, flowId: string): Promise<FlowRow | undefined> {
  const rows = await db
    .select()
    .from(flows)
    .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
    .limit(1);
  const row = rows[0];

  return row ? withCurrentDefinition(row) : undefined;
}

export async function insertFlow(db: Database, values: InsertFlowValues): Promise<FlowRow> {
  const rows = await db.insert(flows).values(values).returning();
  const inserted = rows[0];

  if (!inserted) {
    throw new Error("Inserting a flow returned no row");
  }

  return withCurrentDefinition(inserted);
}

/**
 * Returns `undefined` when nothing matched, which is either a flow that does not exist or one
 * belonging to another workspace. The caller cannot tell the two apart, and should not be able to.
 */
export async function updateFlowForTenant(
  db: Database,
  tenantId: string,
  flowId: string,
  values: UpdateFlowValues,
): Promise<FlowRow | undefined> {
  const rows = await db
    .update(flows)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
    .returning();
  const row = rows[0];

  return row ? withCurrentDefinition(row) : undefined;
}

export async function deleteFlowForTenant(db: Database, tenantId: string, flowId: string): Promise<boolean> {
  const rows = await db
    .delete(flows)
    .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
    .returning({ id: flows.id });

  return rows.length > 0;
}
