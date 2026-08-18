/**
 * Operator console requests and the query key they are cached under.
 */

import { config, type OpsConsoles, opsConsolesSchema } from "@automend/shared";
import { z } from "zod";
import { requestApi } from "./api";

const { operations, operationsConsoles, operationsSession } = config.http.routes;

/** `requestApi` prefixes the versioned base path, so these are relative to it. */
const CONSOLES_PATH = `${operations.slice(config.http.basePath.length)}${operationsConsoles}`;
const SESSION_PATH = `${operations.slice(config.http.basePath.length)}${operationsSession}`;

export const operationsQueryKeys = {
  all: ["operations"] as const,
  consoles: () => [...operationsQueryKeys.all, "consoles"] as const,
};

export async function fetchOpsConsoles(signal?: AbortSignal): Promise<OpsConsoles> {
  return await requestApi({ path: CONSOLES_PATH, schema: opsConsolesSchema, signal });
}

const unlockedSchema = z.object({ unlocked: z.boolean() });

/**
 * Exchanges the operator password for the cookie the queue dashboard checks.
 *
 * The cookie is `HttpOnly`, so nothing here can read it back — which is the point. The page learns
 * whether it worked from this response, and on a later visit from `fetchOpsConsoles`.
 */
export async function unlockQueueDashboard(password: string): Promise<void> {
  await requestApi({ path: SESSION_PATH, schema: unlockedSchema, method: "POST", body: { password } });
}

export async function lockQueueDashboard(): Promise<void> {
  await requestApi({ path: SESSION_PATH, schema: unlockedSchema, method: "DELETE" });
}
