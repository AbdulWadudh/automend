import { sql } from "drizzle-orm";
import type { Database } from "./client";

/**
 * Issues the cheapest possible round-trip to Postgres.
 *
 * Rejects if the database is unreachable, which is what makes `/health` a real dependency check
 * instead of a hardcoded 200.
 */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
