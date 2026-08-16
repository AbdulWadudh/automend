/**
 * `/api/v1/hooks/:flowId/:path` — where a third-party service delivers to a flow.
 *
 * The only unauthenticated route in the versioned API, and the only one that reads a flow without
 * a workspace to scope it to. Both follow from what a webhook is: the caller is somebody else's
 * server, which has no session and never will. The flow id in the URL is what stands in for
 * authentication — a UUID the workspace chose to hand out — which is why the address is a
 * credential and is treated as one.
 *
 * Every method is accepted, because a webhook receiver does not get to choose what a sender sends.
 *
 * What it does *not* do yet is run the flow: the execution engine does not exist. So a delivery is
 * recorded rather than acknowledged and dropped — `202` here means "stored, and it will run", and
 * the unprocessed rows are what the engine will drain. Answering `202` to a sender for something
 * discarded would be the kind of lie that is discovered months later.
 */

import { findFlowForWebhook, recordWebhookDelivery } from "@automend/db";
import { config, notFoundError, requestValidationError } from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { parseUuidParam } from "../http/validation";

const FLOW_ID_PARAM = "flowId";
const { webhook } = config.flows;

const REDACTED_HEADERS = new Set<string>(webhook.redactedHeaders);

/**
 * The headers worth keeping, which is all of them except the ones that authenticate the sender.
 * A delivery log that captured `Authorization` would be a store of other people's credentials.
 */
function collectHeaders(headers: Headers): Record<string, string> {
  const collected: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (!REDACTED_HEADERS.has(name.toLowerCase())) {
      collected[name] = value;
    }
  });

  return collected;
}

/**
 * Reads the body, refusing anything oversized.
 *
 * An unauthenticated endpoint that writes to the database has to bound what it will keep, and the
 * check is on the bytes actually read rather than on `Content-Length`, which a sender controls.
 */
async function readBody(request: Request): Promise<string | null> {
  const body = await request.text();

  if (body.length === 0) {
    return null;
  }

  if (Buffer.byteLength(body, "utf8") > webhook.maxBodyBytes) {
    throw requestValidationError(`The request body exceeds ${webhook.maxBodyBytes} bytes`);
  }

  return body;
}

export function createHookRoutes(deps: ApiDependencies): Hono {
  const routes = new Hono();

  routes.all(`/:${FLOW_ID_PARAM}/:path{.*}?`, async (c) => {
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const path = c.req.param("path") ?? "";
    const target = await findFlowForWebhook(deps.db, flowId);

    // One message for "no such flow", "not a webhook flow" and "wrong path". Distinguishing them
    // would let anyone holding a flow id map out how a workspace is configured.
    const trigger = target?.definition.trigger.config;

    if (!target || trigger?.kind !== "webhook" || trigger.path !== path) {
      throw notFoundError("No webhook is listening here");
    }

    const body = await readBody(c.req.raw);
    const url = new URL(c.req.url);

    const delivery = await recordWebhookDelivery(deps.db, {
      tenantId: target.tenantId,
      flowId: target.flowId,
      // The sender's key when it offers one, so its own retries collapse into one delivery.
      idempotencyKey: c.req.header(webhook.idempotencyHeader) ?? crypto.randomUUID(),
      method: c.req.method,
      path,
      query: url.search.length > 1 ? url.search.slice(1) : null,
      headers: collectHeaders(c.req.raw.headers),
      body,
    });

    deps.logger.info(
      {
        flowId: target.flowId,
        tenantId: target.tenantId,
        deliveryId: delivery.id,
        method: c.req.method,
        duplicate: !delivery.isNew,
      },
      "webhook delivery received",
    );

    // A repeat is `200`: it was accepted before, and saying `202` again would suggest a second run.
    return respondWithData(c, { deliveryId: delivery.id, duplicate: !delivery.isNew }, delivery.isNew ? 202 : 200);
  });

  return routes;
}
