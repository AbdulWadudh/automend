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

import type { FlowDefinition, RunError } from "@automend/shared";
import type { EncryptedSecret } from "@automend/shared/crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/**
 * A request that arrived at a flow's webhook.
 *
 * Recorded before anything else happens to it, so an accepted delivery is never lost to a crash,
 * a deploy, or an execution engine that does not exist yet. `processed_at` is what the engine will
 * claim; until then every row sits here unprocessed, which is an honest state rather than a
 * silently dropped request.
 */
export const flowWebhookDeliveries = pgTable(
  "flow_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    /**
     * From the sender's `Idempotency-Key` when it offers one, otherwise generated. Unique per
     * flow, so a retried delivery resolves to the row already stored instead of running twice.
     */
    idempotencyKey: text("idempotency_key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    query: text("query"),
    /** Sensitive headers are dropped before this is written — see `config.flows.webhook`. */
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    body: text("body"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null until the execution engine claims it. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("flow_webhook_deliveries_flow_id_idx").on(table.flowId),
    // What the engine will scan: the oldest unclaimed delivery for any flow.
    index("flow_webhook_deliveries_unprocessed_idx").on(table.receivedAt).where(sql`${table.processedAt} is null`),
    uniqueIndex("flow_webhook_deliveries_flow_idempotency_idx").on(table.flowId, table.idempotencyKey),
  ],
);

export type FlowWebhookDeliveryRow = typeof flowWebhookDeliveries.$inferSelect;

/**
 * One execution of a flow.
 *
 * Two things here are the platform's non-negotiables made physical.
 *
 * `(flow_id, idempotency_key)` is unique, so a sender retrying a webhook, a poll returning an item it
 * has already returned, or somebody double-clicking Run resolves to the row that already exists rather
 * than creating a second run. That check lives in the database because a read-then-write in application
 * code races with the concurrent retry it is meant to stop.
 *
 * `definition_snapshot` is the flow *as it was* when the run started. Without it, editing a flow would
 * rewrite the history of every run in flight — a run would finish against steps it never began with, and
 * a retry an hour later would execute something nobody had reviewed.
 */
export const flowRuns = pgTable(
  "flow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    /** From `config.runs.statuses`. Text rather than a pg enum, so adding one is not a type migration. */
    status: text("status").notNull(),
    /** Which kind of trigger produced this run — see `config.runs.sources`. */
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    definitionSnapshot: jsonb("definition_snapshot").$type<FlowDefinition>().notNull(),
    /** What the trigger produced. The first step's variables resolve against this. */
    triggerPayload: jsonb("trigger_payload"),
    error: jsonb("error").$type<RunError>(),
    /** Null until the worker collects the job; a pending run has been created but not started. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // What the builder asks for: this flow's runs, newest first.
    index("flow_runs_flow_created_idx").on(table.flowId, table.createdAt.desc()),
    index("flow_runs_tenant_id_idx").on(table.tenantId),
    uniqueIndex("flow_runs_flow_idempotency_idx").on(table.flowId, table.idempotencyKey),
  ],
);

export type FlowRunRow = typeof flowRuns.$inferSelect;
export type NewFlowRunRow = typeof flowRuns.$inferInsert;

/**
 * What one step did, on one attempt.
 *
 * This is the journal that makes retrying a flow safe. When BullMQ hands the same job back after a
 * failure, the engine finds the steps that already succeeded recorded here and **replays their stored
 * output instead of invoking them again** — which is the only reason a third attempt at a flow does not
 * send a third email.
 *
 * The unique index is on `(run_id, step_id, attempt)` rather than `(run_id, step_id)`: a retried step
 * gets a new row rather than overwriting the old one, because discarding the record of a failed attempt
 * discards the only evidence of what went wrong.
 *
 * `step_name`, `kit_id` and `action_name` are copied rather than joined, so the journal stays readable
 * after the flow is edited or the step is deleted.
 */
export const flowStepRuns = pgTable(
  "flow_step_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => flowRuns.id, { onDelete: "cascade" }),
    /** The node's id inside the definition snapshot, not a foreign key — the step may since be gone. */
    stepId: uuid("step_id").notNull(),
    stepName: text("step_name").notNull(),
    kitId: text("kit_id").notNull(),
    actionName: text("action_name").notNull(),
    status: text("status").notNull(),
    /** 1 for the first try. A second row for the same step means the job was retried. */
    attempt: integer("attempt").notNull(),
    /** What the step was actually given, after variables were substituted. */
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error").$type<RunError>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("flow_step_runs_run_id_idx").on(table.runId),
    uniqueIndex("flow_step_runs_run_step_attempt_idx").on(table.runId, table.stepId, table.attempt),
  ],
);

export type FlowStepRunRow = typeof flowStepRuns.$inferSelect;
export type NewFlowStepRunRow = typeof flowStepRuns.$inferInsert;

/**
 * The transactional outbox.
 *
 * A queue job must never be a side effect of a Postgres write that could still roll back. Enqueue
 * directly and the failure mode is a job for a run that does not exist; write only the run and the
 * failure mode is a run nobody ever executes. So the run and the intent to enqueue it are written in
 * **one** transaction, and a relay in the worker publishes what it finds and stamps `published_at`.
 *
 * This is also what makes the webhook receiver honest: it has been answering `202` for runs that could
 * never happen, because there was nothing to carry the intent across.
 */
export const flowRunOutbox = pgTable(
  "flow_run_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => flowRuns.id, { onDelete: "cascade" }),
    /** Which queue this belongs on. One column now, so a second queue needs no second table. */
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    /** Null until the relay has handed it to the queue. Published rows are kept briefly, then pruned. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly what the relay claims: the oldest unpublished rows. Partial, so the index stays small as
    // published rows accumulate behind it.
    index("flow_run_outbox_unpublished_idx").on(table.createdAt).where(sql`${table.publishedAt} is null`),
    index("flow_run_outbox_run_id_idx").on(table.runId),
  ],
);

export type FlowRunOutboxRow = typeof flowRunOutbox.$inferSelect;
export type NewFlowRunOutboxRow = typeof flowRunOutbox.$inferInsert;

/**
 * The small amount of state a trigger may remember between firings — `ctx.store`.
 *
 * Its purpose is deduplication: which message did I last see. The primary key is the whole scope tuple,
 * so a kit cannot name a key that reaches another workspace's data — the scoping is structural rather
 * than something every kit author has to remember to do.
 */
export const kitStores = pgTable(
  "kit_stores",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    /** The trigger node's id, so re-pointing a flow at a new trigger starts from a clean cursor. */
    triggerId: uuid("trigger_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.flowId, table.triggerId, table.key] })],
);

export type KitStoreRow = typeof kitStores.$inferSelect;

/**
 * Which trigger is switched on, for the scheduler to read.
 *
 * Nothing fires from a schedule yet — that is a later change — but the table exists now because
 * `onEnable` has to record something when a flow is saved, and a polling cursor with no row to own it
 * would be orphaned state nobody could find or clear.
 *
 * One row per flow, because a flow has exactly one trigger. Re-pointing a flow replaces the row rather
 * than accumulating them.
 */
export const flowTriggerRegistrations = pgTable(
  "flow_trigger_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    triggerId: uuid("trigger_id").notNull(),
    kitId: text("kit_id").notNull(),
    triggerName: text("trigger_name").notNull(),
    /** Copied from the trigger definition so the scheduler can select on it without loading every kit. */
    strategy: text("strategy").notNull(),
    /** A cron expression for a `cron` trigger, a poll interval for a `polling` one. Null otherwise. */
    schedule: text("schedule"),
    enabled: boolean("enabled").notNull().default(false),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("flow_trigger_registrations_flow_idx").on(table.flowId),
    // What the scheduler will scan: everything switched on with a given strategy.
    index("flow_trigger_registrations_strategy_idx").on(table.strategy).where(sql`${table.enabled}`),
  ],
);

export type FlowTriggerRegistrationRow = typeof flowTriggerRegistrations.$inferSelect;
