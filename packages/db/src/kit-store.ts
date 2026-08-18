/**
 * `ctx.store` — the small amount of state a trigger may remember between firings.
 *
 * Every function takes the whole scope tuple, and that is not verbosity: the primary key *is* the scope, so
 * a kit cannot construct a key that reaches another workspace's data. Tenant isolation here is structural
 * rather than something each kit author has to remember to apply.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { kitStores } from "./schema";

export type KitStoreScope = {
  tenantId: string;
  flowId: string;
  /** The trigger node's id, so re-pointing a flow at a new trigger starts from a clean cursor. */
  triggerId: string;
};

function whereScopedKey(scope: KitStoreScope, key: string) {
  return and(
    eq(kitStores.tenantId, scope.tenantId),
    eq(kitStores.flowId, scope.flowId),
    eq(kitStores.triggerId, scope.triggerId),
    eq(kitStores.key, key),
  );
}

/**
 * Returns `undefined` both for a key that was never set and for one explicitly set to null.
 *
 * The two are the same thing to a kit — "I have no cursor" — and distinguishing them would invite a caller
 * to treat a null cursor as a real one.
 */
export async function getKitStoreValue(db: Database, scope: KitStoreScope, key: string): Promise<unknown> {
  const rows = await db.select({ value: kitStores.value }).from(kitStores).where(whereScopedKey(scope, key)).limit(1);

  return rows[0]?.value ?? undefined;
}

export async function putKitStoreValue(db: Database, scope: KitStoreScope, key: string, value: unknown): Promise<void> {
  await db
    .insert(kitStores)
    .values({ ...scope, key, value })
    .onConflictDoUpdate({
      target: [kitStores.tenantId, kitStores.flowId, kitStores.triggerId, kitStores.key],
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteKitStoreValue(db: Database, scope: KitStoreScope, key: string): Promise<void> {
  await db.delete(kitStores).where(whereScopedKey(scope, key));
}

/**
 * Clears every key a trigger holds.
 *
 * Called when a trigger is switched off or replaced. Leaving the cursor behind would mean re-enabling a
 * trigger months later resumed from a position that no longer means anything — which for a `lastItem` cursor
 * is how a flow silently misses everything since.
 */
export async function clearKitStoreForTrigger(db: Database, scope: KitStoreScope): Promise<void> {
  await db
    .delete(kitStores)
    .where(
      and(
        eq(kitStores.tenantId, scope.tenantId),
        eq(kitStores.flowId, scope.flowId),
        eq(kitStores.triggerId, scope.triggerId),
      ),
    );
}
