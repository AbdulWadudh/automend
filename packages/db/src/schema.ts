/**
 * Drizzle schema.
 *
 * Every tenant-owned table carries `tenant_id` from the very first migration — retrofitting
 * multi-tenancy later means rewriting every query and backfilling every row.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const flows = pgTable(
  "flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every read of this table is scoped by tenant, so that is the index worth having on day one.
  (table) => [index("flows_tenant_id_idx").on(table.tenantId)],
);

export type FlowRow = typeof flows.$inferSelect;
export type NewFlowRow = typeof flows.$inferInsert;
