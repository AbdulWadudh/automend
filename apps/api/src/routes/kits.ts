/**
 * `/api/v1/kits` — the catalogue the builder renders from.
 *
 * The builder has to draw a step picker and a settings form for every kit, which means it needs kit
 * *metadata*: what fields an action has, what type each one is, what a trigger's sample payload looks like. It
 * emphatically does not need kit *code*, which calls third-party APIs and has no business in a browser bundle.
 * So the registry is described here and served, and the web app parses the response with the same schema this
 * builds it from.
 *
 * Session-guarded, though it exposes no workspace data. Two reasons: `available` reflects which connectors this
 * deployment has configured, which is a fact about the installation rather than about kits, and the catalogue is
 * a map of everything the platform can reach — not secret, but not worth handing to anonymous callers either.
 */

import { resolveConnectionCredential } from "@automend/auth";
import { findConnectionForTenant } from "@automend/db";
import { toKitCatalogue } from "@automend/kit-framework";
import { loadDynamicOptions } from "@automend/kit-runtime";
import { findAction, findTrigger, kits } from "@automend/kits";
import { config, loadPropertyOptionsRequestSchema, notFoundError, requestValidationError } from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody } from "../http/validation";

export function createKitRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(createRequireSession(deps));

  routes.get("/", (c) => {
    // Rebuilt per request rather than cached at module load: `availableConnectors` is resolved from the
    // environment when the process starts, and the cost of describing three kits is not worth a cache that
    // could go stale against it.
    const catalogue = toKitCatalogue(kits, { availableConnectorIds: deps.availableConnectors });

    return respondWithData(c, catalogue);
  });

  /**
   * The choices for one dynamic dropdown.
   *
   * A POST rather than a GET because it carries the step as configured so far, and because it is not
   * a read of ours — it makes the service call it describes, with the workspace's credential.
   *
   * The loader itself runs in the subprocess `kit-runtime` owns, never here. That is the same rule a
   * step obeys and for the same reason: this process holds `DATABASE_URL` and `SECRETS_KEY`, and kit
   * code has no business in a process that does.
   */
  routes.post("/options", async (c) => {
    const { tenantId } = getRequestContext(c);
    const body = await parseJsonBody(c, loadPropertyOptionsRequestSchema);

    const target =
      body.target === "action" ? findAction(body.kitId, body.targetName) : findTrigger(body.kitId, body.targetName);
    const property = target?.props[body.propertyName];

    if (!property) {
      throw notFoundError(`${body.kitId}.${body.targetName} has no property called ${body.propertyName}`);
    }

    if (property.type !== "dynamicDropdown") {
      // A static dropdown already carries its choices in the catalogue, so asking for them here is a
      // caller that has misread the property rather than an empty list.
      throw requestValidationError(`${body.propertyName} is a ${property.type}, which has no options to load`);
    }

    // Checked before resolving so the caller gets a 404 rather than a 500. `resolveConnectionCredential`
    // raises a step failure, which is the right shape for a run and the wrong one for a request: naming a
    // connection this workspace does not own is the caller's mistake, not this deployment failing.
    const connection = await findConnectionForTenant(deps.db, tenantId, body.connectionId);

    if (!connection) {
      // Scoped by tenant, so another workspace's connection is simply absent — the same answer one that
      // never existed gets, and it stays that way rather than confirming the id belongs to somebody.
      throw notFoundError("That connection does not exist");
    }

    let credential: Awaited<ReturnType<typeof resolveConnectionCredential>>;

    try {
      credential = await resolveConnectionCredential(deps.db, deps.auth, deps.secretsKey, tenantId, body.connectionId);
    } catch (error) {
      // Reaching here means the connection exists but cannot currently be used — a revoked grant, or a
      // refresh that failed. The author has to reconnect, so it is their problem to act on, not a 500.
      throw requestValidationError(
        `That connection cannot be used — ${error instanceof Error ? error.message : "it could not be resolved"}`,
      );
    }

    const options = await loadDynamicOptions({
      kitId: body.kitId,
      target: body.target,
      targetName: body.targetName,
      propertyName: body.propertyName,
      input: body.input,
      credential,
      allowPrivateNetwork: deps.allowPrivateNetwork,
    });

    return respondWithData(c, { options, truncated: options.length >= config.kits.maxDynamicOptions });
  });

  return routes;
}
