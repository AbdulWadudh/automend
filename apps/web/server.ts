/**
 * Production server for the web app.
 *
 * Serves the built bundle and proxies two prefixes onward:
 *
 * - the API prefix, to the API service
 * - the OTLP prefix, to the telemetry collector
 *
 * Both exist for the same reason: the browser only ever calls this origin, so neither the API
 * address nor the collector address is compiled into the bundle, and the collector needs no CORS
 * configuration and no public exposure. Targets are read from the environment at container start.
 *
 * The Vite dev server proxies the same two prefixes via `server.proxy` in `vite.config.ts`.
 */

import { API_ERROR_CODES, config } from "@automend/shared";
import { loadWebServerEnv } from "@automend/shared/env";
import { forwardRequest } from "@automend/shared/http-proxy";
import { createLogger } from "@automend/shared/logger";
import { startLogTelemetry } from "@automend/shared/telemetry";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const env = loadWebServerEnv();
const serviceConfig = config.services.web;

const telemetry = env.OTEL_LOGS_ENABLED
  ? startLogTelemetry({
      serviceName: serviceConfig.name,
      serviceVersion: config.appVersion,
      environment: env.NODE_ENV,
      endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: env.OTEL_EXPORTER_OTLP_HEADERS,
    })
  : undefined;

const logger = createLogger({
  service: serviceConfig.name,
  level: env.LOG_LEVEL,
  otelLogger: telemetry?.logger,
});

const indexHtmlPath = `${serviceConfig.staticRoot}/${serviceConfig.indexFile}`;

const app = new Hono();

app.get(config.http.routes.health, (c) => c.json({ data: { service: serviceConfig.name, status: "healthy" } }));

function unavailable(message: string): Response {
  return Response.json({ error: { code: API_ERROR_CODES.DEPENDENCY_UNAVAILABLE, message } }, { status: 503 });
}

app.all(config.http.routes.apiProxyPattern, async (c) => {
  const incomingUrl = new URL(c.req.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, env.API_URL);

  try {
    return await forwardRequest(c.req.raw, targetUrl);
  } catch (error) {
    logger.error({ err: error, path: incomingUrl.pathname }, "api proxy request failed");
    return unavailable("The API is unreachable");
  }
});

/**
 * Browser telemetry. `/otlp/v1/logs` on this origin becomes `/v1/logs` on the collector, so the
 * collector stays on the private network and the browser never learns its address.
 */
app.all(config.http.routes.otlpProxyPattern, async (c) => {
  const incomingUrl = new URL(c.req.url);
  const collectorPath = incomingUrl.pathname.slice(config.http.routes.otlpProxyPrefix.length);
  const targetUrl = new URL(`${collectorPath}${incomingUrl.search}`, env.OTEL_EXPORTER_OTLP_ENDPOINT);

  try {
    return await forwardRequest(c.req.raw, targetUrl);
  } catch (error) {
    // Logged at warn: losing browser telemetry must not read as an application outage.
    logger.warn({ err: error, path: incomingUrl.pathname }, "otlp proxy request failed");
    return unavailable("The telemetry collector is unreachable");
  }
});

app.use(config.http.routes.matchAll, serveStatic({ root: serviceConfig.staticRoot }));

// Client-side routing: any path that is not a real file is handed to the SPA to resolve.
app.get(config.http.routes.wildcard, () => {
  return new Response(Bun.file(indexHtmlPath), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

const server = Bun.serve({ port: env.WEB_PORT, fetch: app.fetch });

logger.info(
  { port: server.port, apiUrl: env.API_URL, telemetryEnabled: env.OTEL_LOGS_ENABLED },
  "web server listening",
);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, "shutting down web server");
  await server.stop();
  await telemetry?.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
