/**
 * Postgres connection handling.
 *
 * All database access in the platform goes through the Drizzle instance created here —
 * no raw connections and no string-concatenated SQL anywhere else.
 */

import { config } from "@automend/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DatabaseClient = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool;
  /** Drains the pool so a process can shut down without leaving connections open. */
  close: () => Promise<void>;
};

export type Database = DatabaseClient["db"];

export type CreateDatabaseClientOptions = {
  databaseUrl: string;
  maxConnections?: number;
};

export function createDatabaseClient({
  databaseUrl,
  maxConnections = config.database.apiMaxConnections,
}: CreateDatabaseClientOptions): DatabaseClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    idleTimeoutMillis: config.database.idleTimeoutMs,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
