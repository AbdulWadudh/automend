/**
 * The middleware that turns a cookie into a tenant.
 *
 * Every route mounted behind it can assume two things: there is a signed-in user, and there is a
 * workspace id to scope its queries by. Routes never read the session themselves, so no handler
 * can forget the membership check that `resolveRequestContext` performs.
 */

import type { AuthenticatedRequestContext } from "@automend/auth";
import { resolveRequestContext } from "@automend/auth";
import { unauthenticatedError } from "@automend/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiDependencies } from "../dependencies";

export type SessionEnv = {
  Variables: {
    requestContext: AuthenticatedRequestContext;
  };
};

export function createRequireSession(deps: ApiDependencies): MiddlewareHandler<SessionEnv> {
  return async function requireSession(c, next) {
    const requestContext = await resolveRequestContext({
      auth: deps.auth,
      db: deps.db,
      headers: c.req.raw.headers,
    });

    if (!requestContext) {
      throw unauthenticatedError("Sign in to continue");
    }

    c.set("requestContext", requestContext);

    await next();
  };
}

export function getRequestContext(c: Context<SessionEnv>): AuthenticatedRequestContext {
  return c.get("requestContext");
}
