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

/**
 * A third-party service a workspace has connected, for its flows to act through.
 *
 * The workspace owns the connection, not the person who set it up: a flow posting to Slack must
 * keep working after that person leaves. For an OAuth connection the tokens themselves stay in
 * Better-Auth's `account` table — which already encrypts and refreshes them — and this row is the
 * tenant-scoped pointer to them. For a token connection there is no OAuth dance and the secret
 * lives here, envelope-encrypted.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Which service, from the catalogue in `config.connectors.providers`. */
    providerId: text("provider_id").notNull(),
    /** `oauth` — tokens held by Better-Auth; `token` — a secret held in `encrypted_secret`. */
    kind: text("kind").notNull(),
    /** What the workspace calls it, since one service may be connected several times over. */
    displayName: text("display_name").notNull(),
    /**
     * OAuth only: which Better-Auth account holds the tokens. `getAccessToken` needs both, and the
     * user reference is what lets the worker fetch a token with no session of its own.
     */
    accountId: text("account_id"),
    accountUserId: uuid("account_user_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * Who the connected account belongs to, as the provider reports it.
     *
     * Copied here rather than fetched for every listing: it is what makes one Google connection
     * distinguishable from another, and a list of workspace connections should not depend on three
     * upstream services being reachable. Refreshed whenever the connection is re-authorised.
     */
    accountEmail: text("account_email"),
    accountName: text("account_name"),
    /** Token connections only. Never selected into a response — see `connections.ts`. */
    encryptedSecret: jsonb("encrypted_secret").$type<EncryptedSecret>(),
    /** The last few characters, so a stored token can be recognised without being revealed. */
    secretHint: text("secret_hint"),
    scopes: text("scopes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("connections_tenant_id_idx").on(table.tenantId),
    // One workspace may connect the same service several times, but not the same account twice.
    uniqueIndex("connections_tenant_provider_account_idx")
      .on(table.tenantId, table.providerId, table.accountId)
      .where(sql`${table.accountId} is not null`),
  ],
);

export type ConnectionRow = typeof connections.$inferSelect;
export type NewConnectionRow = typeof connections.$inferInsert;
