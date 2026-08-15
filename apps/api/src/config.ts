import { config } from "@automend/shared";
import { loadApiEnv } from "@automend/shared/env";

/**
 * Evaluated the first time any module imports it, i.e. before the server binds a port.
 * A missing or malformed variable therefore crashes the process at startup with a readable
 * message rather than surfacing as a confusing runtime failure later.
 */
export const env = loadApiEnv();

/** This service's slice of the shared config, so route modules need one import instead of two. */
export const serviceConfig = config.services.api;
