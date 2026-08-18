/**
 * Which trigger each flow is listening on.
 *
 * Nothing fires from a schedule yet — that is the scheduler's change — but the row has to exist as soon as a
 * flow is saved, because a polling cursor written by `onEnable` with no registration to own it is orphaned
 * state: nothing can find it, clear it, or explain why a flow resumed from a cursor set months ago.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { flowTriggerRegistrations } from "./schema";

export type RegisterTriggerValues = {
  tenantId: string;
  flowId: string;
  triggerId: string;
  kitId: string;
  triggerName: string;
  strategy: string;
  /** A cron expression, a poll interval, or null for a trigger that needs no schedule. */
  schedule: string | null;
  enabled: boolean;
};

export type TriggerRegistration = {
  id: string;
  tenantId: string;
  flowId: string;
  triggerId: string;
  kitId: string;
  triggerName: string;
  strategy: string;
  schedule: string | null;
  enabled: boolean;
  lastFiredAt: Date | null;
};

/**
 * Records the trigger a flow is listening on, replacing whatever it was listening on before.
 *
 * Upsert on `flow_id` rather than insert, because a flow has exactly one trigger and swapping it must not
 * leave the old registration behind — a flow would then appear twice to the scheduler and run twice.
 *
 * Returns the previous `trigger_id` when it changed, so the caller can clear the cursor belonging to the
 * trigger that is no longer there.
 */
export async function registerFlowTrigger(
  db: Database,
  values: RegisterTriggerValues,
): Promise<{ replacedTriggerId: string | undefined }> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ triggerId: flowTriggerRegistrations.triggerId })
      .from(flowTriggerRegistrations)
      .where(eq(flowTriggerRegistrations.flowId, values.flowId))
      .limit(1);

    await tx
      .insert(flowTriggerRegistrations)
      .values(values)
      .onConflictDoUpdate({
        target: [flowTriggerRegistrations.flowId],
        set: {
          triggerId: values.triggerId,
          kitId: values.kitId,
          triggerName: values.triggerName,
          strategy: values.strategy,
          schedule: values.schedule,
          enabled: values.enabled,
          updatedAt: new Date(),
        },
      });

    const previous = existing[0]?.triggerId;

    return { replacedTriggerId: previous === values.triggerId ? undefined : previous };
  });
}

export async function findTriggerRegistration(
  db: Database,
  tenantId: string,
  flowId: string,
): Promise<TriggerRegistration | undefined> {
  const rows = await db
    .select()
    .from(flowTriggerRegistrations)
    .where(and(eq(flowTriggerRegistrations.tenantId, tenantId), eq(flowTriggerRegistrations.flowId, flowId)))
    .limit(1);

  return rows[0];
}

/**
 * Everything switched on with a given strategy — what the scheduler will scan.
 *
 * Unscoped by tenant, because the scheduler serves every workspace and has no session. The tenant on each
 * row is what scopes the work it goes on to do.
 */
export async function listEnabledRegistrations(db: Database, strategy: string): Promise<TriggerRegistration[]> {
  return await db
    .select()
    .from(flowTriggerRegistrations)
    .where(and(eq(flowTriggerRegistrations.strategy, strategy), eq(flowTriggerRegistrations.enabled, true)));
}

export async function markTriggerFired(db: Database, registrationId: string): Promise<void> {
  await db
    .update(flowTriggerRegistrations)
    .set({ lastFiredAt: new Date() })
    .where(eq(flowTriggerRegistrations.id, registrationId));
}
