/**
 * Drizzle schema.
 *
 * Every tenant-owned table carries `tenant_id` from the very first migration — retrofitting
 * multi-tenancy later means rewriting every query and backfilling every row.
 *
 * The tenant is a Better-Auth organization: a workspace. Those tables live in `auth-schema.ts`,
 * which is generated from the auth configuration rather than written by hand, and are re-exported
 * here so that one module is the whole schema — for `drizzle-kit`, for the Drizzle client and for
 * the Better-Auth adapter alike.
 */

import type { FlowDefinition } from "@automend/shared";
import type { EncryptedSecret } from "@automend/shared/crypto";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

export * from "./auth-schema";

export const flows = pgTable(
  "flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The workspace that owns this flow. No query may read the table without scoping by it. */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * The graph the builder edits: one trigger, its steps and the edges between them.
     *
     * Stored as a document rather than as node and edge tables because it is always read and
     * written whole — a flow is only ever loaded in full, and saving it must be one atomic write.
     * `$type` keeps the column honest on the TypeScript side; the Zod schema is what validates it
     * at the boundary, since nothing stops another writer from putting anything in a jsonb column.
     */
    definition: jsonb("definition").$type<FlowDefinition>().notNull(),
    /** Kept when the author leaves the workspace, so the flow's history stays readable. */
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every read of this table is scoped by tenant, so that is the index worth having on day one.
  (table) => [index("flows_tenant_id_idx").on(table.tenantId)],
);

export type FlowRow = typeof flows.$inferSelect;
export type NewFlowRow = typeof flows.$inferInsert;
