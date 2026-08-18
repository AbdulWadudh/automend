/**
 * The queue dashboard — Bull Board, mounted as a Hono sub-app.
 *
 * What it is for: seeing what the `{flow-executions}` queue is actually doing. Which jobs are
 * waiting, which failed and why, and retrying one once the cause is fixed. The outbox relay already
 * reports a row it has given up on, but "the run exists, it looks queued, and nothing will ever
 * execute it" is a class of problem you diagnose by looking at the queue, not at a log line.
 *
 * Three things about it are deliberate.
 *
 * **It is not behind the user session.** The queue is one queue for the whole deployment, so a job in
 * it belongs to some tenant and the dashboard shows all of them. Putting it behind `requireSession`
 * would therefore not scope anything — it would hand any signed-in user every other workspace's job
 * payloads. It is gated on the operator password instead, presented on the Operations page and carried
 * here as the cookie `http/ops-session.ts` issues. It does not exist at all until a deployment
 * configures one: see `createQueueDashboardRoutes` returning `undefined`.
 *
 * **It is not read-only.** Retrying and removing jobs is the point of having it. That also means the
 * password admits somebody who can enqueue a job of their own, and the worker will run it: the
 * payload is Zod-validated, so a malformed one is rejected, but a well-formed one is a real
 * execution of a real tenant's flow. Treat the credential as an administrative one.
 *
 * **It lives off `/api/v1`.** Every versioned route answers with the `{ data }` / `{ error }`
 * envelope; this one serves HTML, an EJS-rendered shell and a static bundle. It is mounted under
 * `config.http.routes.queueDashboard` and the web app proxies that prefix onward unchanged.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, unauthenticatedError } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { Queue } from "bullmq";
import { Hono, type MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { Redis } from "ioredis";
import type { OpsSession } from "../http/ops-session";

export type CreateQueueDashboardOptions = {
  /**
   * Absent when the deployment configured no operator credentials, which is what switches the
   * dashboard off — there is then nothing that could ever unlock it.
   */
  opsSession: OpsSession | undefined;
  /**
   * The api's own Redis client, reused rather than a second one opened.
   *
   * A BullMQ `Queue` is a producer, so it asks for a non-blocking connection and accepts a client
   * whose `maxRetriesPerRequest` is set — which a `Worker` would refuse. It is passed as an instance
   * rather than as options so BullMQ treats it as shared and leaves closing it to `deps.shutdown`.
   */
  redis: Redis;
  logger: Logger;
};

/**
 * Where Bull Board's EJS shell and static bundle live on disk.
 *
 * Passed to `createBullBoard` explicitly because it otherwise finds this itself with
 * `eval("require.resolve('@bull-board/ui/package.json')")`. That does resolve under Bun, but the
 * `eval` exists to hide the lookup from bundlers, and a path resolved here fails at start-up rather
 * than as a blank page the first time somebody opens the dashboard.
 */
function resolveUiPackageRoot(): string {
  return dirname(fileURLToPath(import.meta.resolve("@bull-board/ui/package.json")));
}

/**
 * Refuses anyone who has not presented the operator password on the Operations page.
 *
 * A browser *navigating* here is sent to that page rather than shown a bare 401 — arriving at an error
 * with no way forward is the whole problem the page exists to fix. The dashboard's own XHR and its
 * static bundle get the 401 envelope instead: following a redirect would hand its fetches an HTML
 * page, which is a far more confusing failure than a status code.
 */
function requireOpsSession(opsSession: OpsSession): MiddlewareHandler {
  return async function guard(c, next) {
    if (await opsSession.isGranted(c)) {
      await next();
      return;
    }

    if (c.req.header("accept")?.includes("text/html")) {
      // 303 rather than 302: the destination is a page to GET, whatever method got us here.
      return c.redirect(config.webClient.routes.operations, 303);
    }

    throw unauthenticatedError("Unlock the queue dashboard from the Operations page");
  };
}

/**
 * The dashboard's routes, or `undefined` when it is switched off.
 *
 * `undefined` rather than a route that answers 403: an operator surface that is not configured
 * should not advertise that it exists.
 */
export function createQueueDashboardRoutes(options: CreateQueueDashboardOptions): Hono | undefined {
  const { opsSession, redis, logger } = options;

  if (!opsSession) {
    return undefined;
  }

  const queue = new Queue(config.queue.flowExecutions.name, { connection: redis });

  const serverAdapter = new HonoAdapter(serveStatic);
  serverAdapter.setBasePath(config.http.routes.queueDashboard);

  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
    options: {
      uiBasePath: resolveUiPackageRoot(),
      uiConfig: { boardTitle: config.ops.queueDashboard.boardTitle },
    },
  });

  const routes = new Hono();

  // Before the plugin, and over the wildcard rather than the entry route alone: the shell, the
  // static bundle and the JSON endpoints behind it are each reachable directly.
  routes.use(config.http.routes.wildcard, requireOpsSession(opsSession));
  /**
   * The dashboard registers its entry point without a trailing slash, so `/ops/queues/` would answer
   * with the API's JSON 404 — and this is a URL people reach by pasting it. Its own `<base href>`
   * carries the slash, which is exactly what invites the mistake.
   */
  routes.use(config.http.routes.wildcard, trimTrailingSlash());
  routes.route("/", serverAdapter.registerPlugin());

  logger.info(
    { path: config.http.routes.queueDashboard, queue: config.queue.flowExecutions.name },
    "queue dashboard mounted",
  );

  return routes;
}
