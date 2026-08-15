import { config } from "@automend/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiDependencies } from "./dependencies";
import { createErrorHandler, notFoundHandler } from "./http/error-handler";
import { createRequestLogger } from "./http/request-logger";
import { createFlowRoutes } from "./routes/flows";
import { createHealthRoutes } from "./routes/health";

export function createApp(deps: ApiDependencies): Hono {
  const app = new Hono();

  app.use(config.http.routes.wildcard, createRequestLogger(deps.logger));
  app.use(
    config.http.routes.apiProxyPattern,
    cors({
      origin: deps.allowedOrigins,
      allowMethods: [...config.http.cors.allowedMethods],
      credentials: config.http.cors.allowCredentials,
    }),
  );

  const healthRoutes = createHealthRoutes(deps);

  // Mounted twice on purpose: the bare health path is what the container platform probes, while
  // the versioned one is what the browser reaches through the web app's `/api` proxy.
  app.route(config.http.routes.health, healthRoutes);
  app.route(config.http.routes.apiHealth, healthRoutes);
  app.route(config.http.routes.flows, createFlowRoutes(deps));

  app.notFound(notFoundHandler);
  app.onError(createErrorHandler(deps.logger));

  return app;
}
