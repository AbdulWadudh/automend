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

import { toKitCatalogue } from "@automend/kit-framework";
import { kits } from "@automend/kits";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { createRequireSession, type SessionEnv } from "../http/session";

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

  return routes;
}
