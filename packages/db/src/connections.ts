/**
 * Connection queries.
 *
 * Two rules run through all of them. Every query is scoped by `tenantId`, exactly as the flow
 * queries are. And the encrypted secret is never included in a listing: it is selected only by
 * `findConnectionSecret`, which exists so that the one place a secret is read is greppable.
 */

import type { EncryptedSecret } from "@automend/shared/crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { type ConnectionRow, connections } from "./schema";

/** A connection as everything except the token-reading path sees it: no secret material. */
export type ConnectionSummary = Omit<ConnectionRow, "encryptedSecret">;

const summaryColumns = {
  id: connections.id,
  tenantId: connections.tenantId,
  providerId: connections.providerId,
  kind: connections.kind,
  displayName: connections.displayName,
  accountId: connections.accountId,
  accountUserId: connections.accountUserId,
  accountEmail: connections.accountEmail,
  accountName: connections.accountName,
  secretHint: connections.secretHint,
  scopes: connections.scopes,
  createdBy: connections.createdBy,
  createdAt: connections.createdAt,
  updatedAt: connections.updatedAt,
};

export type InsertConnectionValues = {
  tenantId: string;
  providerId: string;
  kind: string;
  displayName: string;
  accountId?: string | null;
  accountUserId?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  encryptedSecret?: EncryptedSecret | null;
  secretHint?: string | null;
  scopes?: string | null;
  createdBy: string | null;
};

export async function listConnectionsForTenant(db: Database, tenantId: string): Promise<ConnectionSummary[]> {
  return await db
    .select(summaryColumns)
    .from(connections)
    .where(eq(connections.tenantId, tenantId))
    .orderBy(desc(connections.createdAt));
}

export async function findConnectionForTenant(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<ConnectionSummary | undefined> {
  const rows = await db
    .select(summaryColumns)
    .from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
    .limit(1);

  return rows[0];
}

export async function insertConnection(db: Database, values: InsertConnectionValues): Promise<ConnectionSummary> {
  const rows = await db.insert(connections).values(values).returning(summaryColumns);
  const inserted = rows[0];

  if (!inserted) {
    throw new Error("Inserting a connection returned no row");
  }

  return inserted;
}

/**
 * Records an OAuth connection, or refreshes the one already there.
 *
 * Idempotent on purpose. The browser posts this after returning from the provider, and that can
 * happen more than once for a single authorisation — a double-invoked effect in development, a
 * refresh of the callback URL, a retried request. An insert would fail the second time on the
 * unique index and surface as a server error beside a connection that had, in fact, been made.
 *
 * The conflict updates the scopes and the timestamp but deliberately leaves `display_name` alone:
 * re-authorising a service must not undo the name someone gave it.
 */
export async function upsertOAuthConnection(db: Database, values: InsertConnectionValues): Promise<ConnectionSummary> {
  const rows = await db
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({
      target: [connections.tenantId, connections.providerId, connections.accountId],
      targetWhere: sql`${connections.accountId} is not null`,
      set: {
        scopes: values.scopes ?? null,
        accountUserId: values.accountUserId ?? null,
        accountEmail: values.accountEmail ?? null,
        accountName: values.accountName ?? null,
        updatedAt: new Date(),
      },
    })
    .returning(summaryColumns);

  const stored = rows[0];

  if (!stored) {
    throw new Error("Recording a connection returned no row");
  }

  return stored;
}

/** How many of a service a workspace already has, so a second one can be named distinctly. */
export async function countConnectionsForProvider(db: Database, tenantId: string, providerId: string): Promise<number> {
  const rows = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.providerId, providerId)));

  return rows.length;
}

export async function renameConnectionForTenant(
  db: Database,
  tenantId: string,
  connectionId: string,
  displayName: string,
): Promise<ConnectionSummary | undefined> {
  const rows = await db
    .update(connections)
    .set({ displayName, updatedAt: new Date() })
    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
    .returning(summaryColumns);

  return rows[0];
}

/**
 * Replaces the secret on a token connection.
 *
 * Scoped to `kind = 'token'` in the query itself rather than checked beforehand: an OAuth
 * connection's credentials live in Better-Auth, and writing a secret onto one would produce a row
 * claiming to hold something it does not.
 */
export async function updateConnectionSecretForTenant(
  db: Database,
  tenantId: string,
  connectionId: string,
  encryptedSecret: EncryptedSecret,
  hint: string,
): Promise<ConnectionSummary | undefined> {
  const rows = await db
    .update(connections)
    .set({ encryptedSecret, secretHint: hint, updatedAt: new Date() })
    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId), eq(connections.kind, "token")))
    .returning(summaryColumns);

  return rows[0];
}

export async function deleteConnectionForTenant(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
    .returning({ id: connections.id });

  return rows.length > 0;
}

/**
 * The only query that reads secret material.
 *
 * Separate from the rest so that "what can reach a stored token" is answered by finding the
 * callers of one function. It returns the envelope, not the plaintext — decryption needs the
 * master key, which lives with the caller.
 */
export async function findConnectionSecret(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<EncryptedSecret | undefined> {
  const rows = await db
    .select({ encryptedSecret: connections.encryptedSecret })
    .from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
    .limit(1);

  return rows[0]?.encryptedSecret ?? undefined;
}
