/**
 * The health route — a real dependency check.
 *
 * Postgres and Redis are probed on every call and the endpoint answers 503 when either is down,
 * because the container platform uses this to decide whether the instance should receive traffic.
 */

import { pingDatabase } from "@automend/db";
import { type HealthReport, measureDependencyHealth } from "@automend/shared";
import { Hono } from "hono";
import { serviceConfig } from "../config";
import type { ApiDependencies } from "../dependencies";
import { respondWithHealth } from "../http/envelope";

export function createHealthRoutes(deps: ApiDependencies): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const logProbeFailure = (dependency: string) => (error: unknown) => {
      deps.logger.error({ err: error, dependency }, "health probe failed");
    };

    // Probed together so a slow dependency does not add its latency to the other's.
    const [postgres, redis] = await Promise.all([
      measureDependencyHealth({ name: "postgres", check: () => pingDatabase(deps.db) }, logProbeFailure("postgres")),
      measureDependencyHealth({ name: "redis", check: () => deps.redis.ping() }, logProbeFailure("redis")),
    ]);

    const isHealthy = postgres.status === "up" && redis.status === "up";

    const report: HealthReport = {
      service: serviceConfig.name,
      status: isHealthy ? "healthy" : "unhealthy",
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { postgres, redis },
    };

    return respondWithHealth(c, report, isHealthy);
  });

  return routes;
}
