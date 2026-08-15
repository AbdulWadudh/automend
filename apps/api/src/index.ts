import { createApp } from "./app";
import { env, serviceConfig } from "./config";
import { createApiDependencies } from "./dependencies";

const deps = createApiDependencies();
const app = createApp(deps);

const server = Bun.serve({
  port: env.API_PORT,
  fetch: app.fetch,
});

deps.logger.info({ service: serviceConfig.name, port: server.port, nodeEnv: env.NODE_ENV }, "api listening");

/**
 * Coolify (and Docker) stop containers with SIGTERM. Stopping the listener before closing the
 * database pool and Redis lets in-flight requests finish instead of failing mid-response.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  deps.logger.info({ signal }, "shutting down api");

  try {
    await server.stop();
    await deps.shutdown();
    process.exit(0);
  } catch (error) {
    deps.logger.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
