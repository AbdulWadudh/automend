import { config } from "@automend/shared";
import { loadWorkerEnv } from "@automend/shared/env";

/** Validated at import time so a misconfigured worker never starts consuming jobs. */
export const env = loadWorkerEnv();

/** This service's slice of the shared config. */
export const serviceConfig = config.services.worker;
