/**
 * Build-time configuration for the browser bundle.
 *
 * The server-side apps use `@automend/shared/env`; the browser cannot, because Vite replaces
 * `import.meta.env` at build time and there is no `process.env` to read. The validation approach
 * is the same: parse once, fail loudly, export a typed object. Defaults come from the shared
 * config module, exactly as they do on the server.
 */

import { config } from "@automend/shared";
import { z } from "zod";

const webEnvSchema = z.object({
  MODE: z.string().min(1),
  DEV: z.boolean(),
  /** Relative on purpose — the API is always reached through this app's own origin. */
  VITE_API_BASE_PATH: z.string().startsWith("/").default(config.webClient.defaultApiBasePath),
});

const parsed = webEnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  throw new Error(`Invalid web environment configuration: ${parsed.error.message}`);
}

export const webEnv = {
  mode: parsed.data.MODE,
  isDev: parsed.data.DEV,
  apiBasePath: parsed.data.VITE_API_BASE_PATH,
} as const;
