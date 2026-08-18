import { config } from "@automend/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiDependencies } from "./dependencies";
import { createErrorHandler, notFoundHandler } from "./http/error-handler";
import { createRequestLogger } from "./http/request-logger";
import { createAuthProviderRoutes } from "./routes/auth-providers";
import { createConnectionRoutes } from "./routes/connections";
import { createFlowRoutes } from "./routes/flows";
import { createHealthRoutes } from "./routes/health";
import { createHookRoutes } from "./routes/hooks";
import { createKitRoutes } from "./routes/kits";
import { createOperationsRoutes } from "./routes/operations";
import { createQueueDashboardRoutes } from "./routes/queue-dashboard";

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

  /**
   * Better-Auth owns everything under its base path and builds its own routing beneath it, so it
   * is handed the raw request rather than being split into Hono routes. It is mounted before the
   * versioned API because those routes require the session it issues.
   */
  app.all(config.http.routes.authPattern, (c) => deps.auth.handler(c.req.raw));

  const healthRoutes = createHealthRoutes(deps);

  // Mounted twice on purpose: the bare health path is what the container platform probes, while
  // the versioned one is what the browser reaches through the web app's `/api` proxy.
  app.route(config.http.routes.health, healthRoutes);
  app.route(config.http.routes.apiHealth, healthRoutes);
  app.route(config.http.routes.authProviders, createAuthProviderRoutes(deps));
  app.route(config.http.routes.flows, createFlowRoutes(deps));
  app.route(config.http.routes.connections, createConnectionRoutes(deps));
  app.route(config.http.routes.kits, createKitRoutes(deps));
  // What the Operations page reads and posts to: which consoles exist, and the operator password.
  app.route(config.http.routes.operations, createOperationsRoutes(deps));
  // Deliberately outside the session middleware: the caller is somebody else's server. See the
  // module for why the URL is what stands in for authentication.
  app.route(config.http.routes.hooks, createHookRoutes(deps));

  /**
   * The queue dashboard, when the deployment configured one. Also outside the session middleware,
   * and for the opposite reason to the hooks above: it reads across every tenant, so a session would
   * scope nothing. It carries its own credential instead — see the module.
   */
  const queueDashboard = createQueueDashboardRoutes({
    opsSession: deps.opsSession,
    redis: deps.redis,
    logger: deps.logger,
  });

  if (queueDashboard) {
    app.route(config.http.routes.queueDashboard, queueDashboard);
  }

  app.notFound(notFoundHandler);
  app.onError(createErrorHandler(deps.logger));

  return app;
}
