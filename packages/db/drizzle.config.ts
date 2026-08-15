import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit is used for one thing only: turning schema changes into committed SQL files
 * (`bun run db:generate`). Applying them is done by `src/migrate.ts`, which validates its
 * environment through the shared typed config module and fails fast when DATABASE_URL is absent.
 *
 * `generate` never opens a connection, so an empty URL here is harmless — it only affects
 * `drizzle-kit studio`, which will report the missing value itself.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
