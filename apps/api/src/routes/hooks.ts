/**
 * `/api/v1/hooks/:flowId/:path` — where a third-party service delivers to a flow.
 *
 * The only unauthenticated route in the versioned API, and the only one that reads a flow without a workspace
 * to scope it to. Both follow from what a webhook is: the caller is somebody else's server, which has no
 * session and never will. The flow id in the URL is what stands in for authentication — a UUID the workspace
 * chose to hand out — which is why the address is a credential and is treated as one.
 *
 * Every method is accepted, because a webhook receiver does not get to choose what a sender sends.
 *
 * **This route now starts runs.** It used to answer `202` — "stored, and it will run" — against an engine that
 * did not exist, which was a lie discoverable only months later. Recording the delivery, creating the run and
 * queueing the intent to execute it are one transaction, so the answer is true or nothing happened at all.
 */

import {
  createFlowRunWithOutbox,
  type Database,
  findFlowForWebhook,
  recordWebhookDelivery,
  type WebhookTarget,
} from "@automend/db";
import { findTrigger } from "@automend/kits";
import {
  buildRunIdempotencyKey,
  config,
  type FlowTriggerNode,
  notFoundError,
  readTriggerText,
  requestValidationError,
} from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { parseUuidParam } from "../http/validation";

const FLOW_ID_PARAM = "flowId";
const { webhook } = config.flows;

const REDACTED_HEADERS = new Set<string>(webhook.redactedHeaders);

/**
 * The headers worth keeping, which is all of them except the ones that authenticate the sender. A delivery log
 * that captured `Authorization` would be a store of other people's credentials.
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
 * An unauthenticated endpoint that writes to the database has to bound what it will keep, and the check is on
 * the bytes actually read rather than on `Content-Length`, which a sender controls.
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

/**
 * Whether this flow is actually listening here.
 *
 * The strategy comes from the registry rather than from a hardcoded kit id, so a second kit that also listens
 * on a URL — an app webhook, say — is answered by this route without it being edited.
 */
function isListeningHere(trigger: FlowTriggerNode, path: string): boolean {
  const definition = findTrigger(trigger.kitId, trigger.triggerName);

  if (definition?.strategy !== "webhook") {
    return false;
  }

  return readTriggerText(trigger, "path") === path;
}

/**
 * What the trigger hands the flow: the delivery as it arrived, not the body alone.
 *
 * A sender's headers are often the interesting part and a body is not always JSON, so `body` is the parsed
 * value when the request declared JSON and the raw text when it did not — a template can reach into one
 * without the other becoming unreadable. Matches `core.webhook`'s `sampleData`, which is what the variable
 * picker offers before the flow has ever run.
 */
function buildTriggerPayload(options: {
  method: string;
  path: string;
  query: string | null;
  headers: Record<string, string>;
  body: string | null;
}): unknown {
  return { ...options, body: parseBodyForTemplates(options.headers, options.body) };
}

function parseBodyForTemplates(headers: Record<string, string>, body: string | null): unknown {
  if (body === null) {
    return null;
  }

  const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    // A sender that promised JSON and sent something else is not worth failing the delivery over — the flow
    // gets the text, and its author can see what actually arrived.
    return body;
  }
}

/**
 * Records the delivery and creates the run it should cause.
 *
 * The delivery's own key is what the run's idempotency key is derived from, which is what makes a sender's
 * retry collapse into one run rather than one run per attempt. Both writes are separately idempotent, so a
 * retry that lands between them resolves rather than duplicating.
 */
async function acceptDelivery(
  db: Database,
  target: WebhookTarget,
  delivery: {
    idempotencyKey: string;
    method: string;
    path: string;
    query: string | null;
    headers: Record<string, string>;
    body: string | null;
  },
) {
  const recorded = await recordWebhookDelivery(db, {
    tenantId: target.tenantId,
    flowId: target.flowId,
    ...delivery,
  });

  const run = await createFlowRunWithOutbox(db, {
    tenantId: target.tenantId,
    flowId: target.flowId,
    source: "webhook",
    idempotencyKey: buildRunIdempotencyKey("webhook", delivery.idempotencyKey),
    definitionSnapshot: target.definition,
    triggerPayload: buildTriggerPayload(delivery),
  });

  return { deliveryId: recorded.id, runId: run.id, isNew: recorded.isNew && run.isNew };
}

export function createHookRoutes(deps: ApiDependencies): Hono {
  const routes = new Hono();

  routes.all(`/:${FLOW_ID_PARAM}/:path{.*}?`, async (c) => {
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const path = c.req.param("path") ?? "";
    const target = await findFlowForWebhook(deps.db, flowId);

    // One message for "no such flow", "not a webhook flow" and "wrong path". Distinguishing them would let
    // anyone holding a flow id map out how a workspace is configured.
    if (!target || !isListeningHere(target.definition.trigger, path)) {
      throw notFoundError("No webhook is listening here");
    }

    const body = await readBody(c.req.raw);
    const url = new URL(c.req.url);

    const accepted = await acceptDelivery(deps.db, target, {
      // The sender's key when it offers one, so its own retries collapse into one delivery and one run.
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
        deliveryId: accepted.deliveryId,
        runId: accepted.runId,
        method: c.req.method,
        duplicate: !accepted.isNew,
      },
      "webhook delivery accepted",
    );

    // A repeat is `200`: it was accepted before, and saying `202` again would suggest a second run.
    return respondWithData(
      c,
      { deliveryId: accepted.deliveryId, runId: accepted.runId, duplicate: !accepted.isNew },
      accepted.isNew ? 202 : 200,
    );
  });

  return routes;
}
