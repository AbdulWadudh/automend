/**
 * Inbound webhook queries.
 *
 * These are the one deliberate exception to tenant scoping in the codebase, and the reason is
 * structural: the caller is a third-party service with no session and no workspace. The flow id in
 * the URL is what stands in for both — which is why the resolved tenant is read *from the flow*
 * and carried onto everything written here, rather than being taken from the request.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { flows, flowWebhookDeliveries } from "./schema";

export type WebhookTarget = {
  flowId: string;
  tenantId: string;
  definition: (typeof flows.$inferSelect)["definition"];
};

/**
 * Finds a flow by id alone, without a workspace to scope it to.
 *
 * Every other read of `flows` takes a tenant. This one cannot: nobody is signed in. It is safe
 * only because the id is a UUID that arrives in an address the workspace chose to hand out, and
 * because the tenant it returns is then used to scope everything downstream.
 */
export async function findFlowForWebhook(db: Database, flowId: string): Promise<WebhookTarget | undefined> {
  const rows = await db
    .select({ flowId: flows.id, tenantId: flows.tenantId, definition: flows.definition })
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1);

  return rows[0];
}

export type RecordDeliveryValues = {
  tenantId: string;
  flowId: string;
  idempotencyKey: string;
  method: string;
  path: string;
  query: string | null;
  headers: Record<string, string>;
  body: string | null;
};

export type RecordedDelivery = {
  id: string;
  /** False when this key had already been delivered, so the caller can say so without guessing. */
  isNew: boolean;
};

/**
 * Stores a delivery, or returns the one already stored under the same key.
 *
 * Senders retry. A retry that produced a second row would become a second execution of the flow —
 * a second charge, a second email — so the unique key on `(flow, idempotency key)` decides, in the
 * database, whether this delivery is new. `DO UPDATE` rather than `DO NOTHING` because only the
 * former returns the conflicting row.
 */
export async function recordWebhookDelivery(db: Database, values: RecordDeliveryValues): Promise<RecordedDelivery> {
  const rows = await db
    .insert(flowWebhookDeliveries)
    .values(values)
    .onConflictDoUpdate({
      target: [flowWebhookDeliveries.flowId, flowWebhookDeliveries.idempotencyKey],
      // Nothing worth changing on a repeat — the update exists only so the conflicting row is
      // returned, which `DO NOTHING` does not do.
      set: { idempotencyKey: values.idempotencyKey },
    })
    .returning({
      id: flowWebhookDeliveries.id,
      /**
       * Whether this statement inserted the row or hit the conflict.
       *
       * `xmax` is the transaction that deleted or locked a row version; on a genuinely new row it
       * is zero, and on one updated by `ON CONFLICT` it is not. It is the only way to tell the two
       * apart from a single statement, and a second query could not — it would find the row either
       * way and race with a concurrent retry besides.
       */
      isNew: sql<boolean>`(xmax = 0)`,
    });

  const stored = rows[0];

  if (!stored) {
    throw new Error("Recording a webhook delivery returned no row");
  }

  return stored;
}

export type DeliverySummary = {
  id: string;
  method: string;
  path: string;
  query: string | null;
  headers: Record<string, string>;
  body: string | null;
  receivedAt: Date;
  processedAt: Date | null;
};

/**
 * The most recent deliveries for a flow, newest first.
 *
 * Tenant-scoped, unlike the write path: this is read by the builder, where somebody *is* signed in,
 * and a workspace must not be able to read another workspace deliveries by flow id.
 */
export async function listDeliveriesForFlow(
  db: Database,
  tenantId: string,
  flowId: string,
  limit: number,
): Promise<DeliverySummary[]> {
  return await db
    .select({
      id: flowWebhookDeliveries.id,
      method: flowWebhookDeliveries.method,
      path: flowWebhookDeliveries.path,
      query: flowWebhookDeliveries.query,
      headers: flowWebhookDeliveries.headers,
      body: flowWebhookDeliveries.body,
      receivedAt: flowWebhookDeliveries.receivedAt,
      processedAt: flowWebhookDeliveries.processedAt,
    })
    .from(flowWebhookDeliveries)
    .where(and(eq(flowWebhookDeliveries.tenantId, tenantId), eq(flowWebhookDeliveries.flowId, flowId)))
    .orderBy(desc(flowWebhookDeliveries.receivedAt))
    .limit(limit);
}
