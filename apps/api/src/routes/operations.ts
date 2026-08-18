/**
 * `/api/v1/operations` — the API behind the Operations page.
 *
 * Two jobs: say which operator consoles this deployment actually has, and exchange the operator
 * password for the short-lived cookie the queue dashboard checks. It is the API *about* the consoles;
 * the consoles themselves live under the `/ops` prefix, which the web app proxies verbatim.
 *
 * Everything here sits behind `requireSession`, and that is worth being precise about, because the
 * session is not what authorises a console. It narrows *who can try*: an operator password is only
 * ever offered to somebody already signed in, so the guess is not available to the open internet.
 * What authorises a console is the password, and the reason it has to is that both consoles read
 * across every tenant — a session would scope nothing.
 */

import { config, opsSignInRequestSchema, unauthenticatedError } from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody } from "../http/validation";

export function createOperationsRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(config.http.routes.wildcard, createRequireSession(deps));

  routes.get(config.http.routes.operationsConsoles, async (c) => {
    const { opsSession } = deps;

    return respondWithData(c, {
      queues: {
        available: opsSession !== undefined,
        unlocked: opsSession ? await opsSession.isGranted(c) : false,
      },
      database: {
        available: deps.studioUrl !== undefined,
        url: deps.studioUrl ?? null,
      },
    });
  });

  routes.post(config.http.routes.operationsSession, async (c) => {
    const { password } = await parseJsonBody(c, opsSignInRequestSchema);
    const { opsSession } = deps;

    // Unconfigured and wrong are answered identically: with nothing configured there is no password
    // that would work, and saying which case it is tells a caller where to keep guessing.
    if (!opsSession?.matchesPassword(password)) {
      // Logged with who tried, because a wrong operator password is the one failed sign-in in this
      // codebase worth noticing. The password itself is never logged, at any level.
      const { userId } = getRequestContext(c);
      deps.logger.warn({ userId }, "an operator password was rejected");

      throw unauthenticatedError("That is not the operator password");
    }

    await opsSession.grant(c);

    return respondWithData(c, { unlocked: true });
  });

  routes.delete(config.http.routes.operationsSession, (c) => {
    deps.opsSession?.clear(c);

    return respondWithData(c, { unlocked: false });
  });

  return routes;
}
