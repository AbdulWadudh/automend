/**
 * `/api/v1/flows` — placeholder listing.
 *
 * It deliberately does not read the `flows` table yet. Every read of tenant-owned data must be
 * scoped by tenant, and the tenant only becomes known once authentication is wired up; shipping
 * an unscoped `select * from flows` in the meantime is exactly the shortcut that is expensive to
 * undo. The route returns an empty collection until `deps` can supply a tenant context.
 */

import type { Flow } from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";

export function createFlowRoutes(_deps: ApiDependencies): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const flows: Flow[] = [];
    return respondWithData(c, flows);
  });

  return routes;
}
