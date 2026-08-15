/**
 * Applies every pending Drizzle migration, then exits.
 *
 * This is the only supported way to change the database schema. It runs as a plain Bun script so
 * production images do not need drizzle-kit installed — they only need the committed SQL files.
 *
 * Usage: `bun run --cwd packages/db db:migrate`
 */

import { fileURLToPath } from "node:url";
import { config } from "@automend/shared";
import { loadDatabaseEnv } from "@automend/shared/env";
import { createLogger } from "@automend/shared/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabaseClient } from "./client";

const env = loadDatabaseEnv();
const logger = createLogger({ service: config.services.migrations.name, level: env.LOG_LEVEL });

const migrationsFolder = fileURLToPath(new URL(config.services.migrations.folder, import.meta.url));

async function runMigrations(): Promise<void> {
  const { db, close } = createDatabaseClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: config.database.migrationMaxConnections,
  });

  try {
    logger.info({ migrationsFolder }, "applying migrations");
    await migrate(db, { migrationsFolder });
    logger.info("migrations applied");
  } finally {
    await close();
  }
}

try {
  await runMigrations();
  process.exit(0);
} catch (error) {
  logger.error({ err: error }, "migration failed");
  process.exit(1);
}
