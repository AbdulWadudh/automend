/**
 * A minimal HTTP surface so the worker — which serves no traffic of its own — can still be
 * health-checked and restarted by the container platform like any other long-running service.
 */

import { pingDatabase } from "@automend/db";
import { API_ERROR_CODES, config, type HealthReport, measureDependencyHealth } from "@automend/shared";
import { env, serviceConfig } from "./config";
import type { WorkerDependencies } from "./dependencies";

async function buildHealthReport(deps: WorkerDependencies): Promise<HealthReport> {
  const logProbeFailure = (dependency: string) => (error: unknown) => {
    deps.logger.error({ err: error, dependency }, "health probe failed");
  };

  const [postgres, redis] = await Promise.all([
    measureDependencyHealth({ name: "postgres", check: () => pingDatabase(deps.db) }, logProbeFailure("postgres")),
    measureDependencyHealth({ name: "redis", check: () => deps.redis.ping() }, logProbeFailure("redis")),
  ]);

  const isHealthy = postgres.status === "up" && redis.status === "up";

  return {
    service: serviceConfig.name,
    status: isHealthy ? "healthy" : "unhealthy",
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: { postgres, redis },
  };
}

export function startHealthServer(deps: WorkerDependencies) {
  return Bun.serve({
    port: env.WORKER_HEALTH_PORT,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (pathname !== config.http.routes.health) {
        return Response.json(
          {
            error: {
              code: API_ERROR_CODES.NOT_FOUND,
              message: `No route matches ${pathname}`,
            },
          },
          { status: 404 },
        );
      }

      const report = await buildHealthReport(deps);
      return Response.json({ data: report }, { status: report.status === "healthy" ? 200 : 503 });
    },
  });
}
