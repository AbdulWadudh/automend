/**
 * Flow queries.
 *
 * Every function here takes `tenantId` as a required argument and applies it to the `where`
 * clause, including the ones that already have a primary key. That is deliberate: a flow id is a
 * UUID a caller could have obtained anywhere, and scoping by tenant is what turns "not yours" into
 * "not found" rather than into a leak.
 */

import type { FlowDefinition } from "@automend/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { type FlowRow, flows } from "./schema";

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

export async function listFlowsForTenant(db: Database, tenantId: string): Promise<FlowRow[]> {
  return await db.select().from(flows).where(eq(flows.tenantId, tenantId)).orderBy(desc(flows.updatedAt));
}

export async function findFlowForTenant(db: Database, tenantId: string, flowId: string): Promise<FlowRow | undefined> {
  const rows = await db
    .select()
    .from(flows)
    .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
    .limit(1);

  return rows[0];
}

export async function insertFlow(db: Database, values: InsertFlowValues): Promise<FlowRow> {
  const rows = await db.insert(flows).values(values).returning();
  const inserted = rows[0];

  if (!inserted) {
    throw new Error("Inserting a flow returned no row");
  }

  return inserted;
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

  return rows[0];
}

export async function deleteFlowForTenant(db: Database, tenantId: string, flowId: string): Promise<boolean> {
  const rows = await db
    .delete(flows)
    .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
    .returning({ id: flows.id });

  return rows.length > 0;
}
