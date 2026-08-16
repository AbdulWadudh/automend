/**
 * `/api/v1/auth-providers` — the part of authentication the browser needs before it has a session.
 *
 * Better-Auth owns everything under `/api/v1/auth/`; this is a sibling of that subtree, not a
 * child, so neither can shadow the other. It answers one question: which sign-in methods did this
 * deployment configure? That is a runtime fact — the credentials arrive as environment variables —
 * so it cannot be baked into the bundle as a build flag.
 */

import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";

export function createAuthProviderRoutes(deps: ApiDependencies): Hono {
  const routes = new Hono();

  routes.get("/", (c) => respondWithData(c, { social: deps.enabledSocialProviders }));

  return routes;
}
