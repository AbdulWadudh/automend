/**
 * The queue dashboard's gate.
 *
 * The dashboard itself is Bull Board's, and testing that it renders would be testing a dependency.
 * What is ours is who gets to reach it, and three separate things about that were wrong at some point
 * during the change that added it — none of them visible to a typecheck:
 *
 * - HTTP Basic was the gate at first, which meant the *browser's* credential dialog: OS chrome over a
 *   themed product, with no way to say what it grants. It is a cookie issued by a real page now, and
 *   the tests below are what pin the cookie's properties.
 * - the 401 came back as a 500, because the API's error handler folded Hono's `HTTPException` into the
 *   generic envelope. Hono's own middleware still signals refusals that way, so that pass-through is
 *   covered here too.
 * - `/ops/queues/` answered the JSON 404, because the entry route is registered without the trailing
 *   slash that the page's own `<base href>` carries.
 */

import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { createErrorHandler, notFoundHandler } from "../../src/http/error-handler";
import { createOpsSession, type OpsSession } from "../../src/http/ops-session";
import { createQueueDashboardRoutes } from "../../src/routes/queue-dashboard";

const OPERATOR_PASSWORD = "p".repeat(config.ops.queueDashboard.passwordMinLength);
const SIGNING_SECRET = "s".repeat(config.auth.secretMinLength);

const HTML_REQUEST = { headers: { Accept: "text/html,application/xhtml+xml" } };

/**
 * Silent, and only the levels these routes call.
 *
 * Cast through `unknown` rather than typed as Pino's `Logger`, which carries child loggers, level
 * machinery and serialisers that nothing here touches — writing them out would be a fixture larger
 * than the module under test.
 */
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/**
 * A stand-in for the api's ioredis client.
 *
 * Never connected to: `new Queue()` only holds onto it, and none of the requests below reach a handler
 * that would issue a command. Redis behaviour is not what these tests are about, and a fake that
 * answered commands would assert BullMQ's implementation rather than our routing.
 */
function fakeRedis(): Redis {
  return { options: {}, status: "ready", on: () => {}, once: () => {}, defineCommand: () => {} } as unknown as Redis;
}

function opsSession(overrides: { password?: string; secureCookie?: boolean } = {}): OpsSession {
  return createOpsSession({
    password: overrides.password ?? OPERATOR_PASSWORD,
    signingSecret: SIGNING_SECRET,
    secureCookie: overrides.secureCookie ?? false,
  });
}

/** The dashboard mounted the way `createApp` mounts it, error handling and all. */
function mountDashboard(session: OpsSession | undefined): Hono {
  const app = new Hono();
  const dashboard = createQueueDashboardRoutes({ opsSession: session, redis: fakeRedis(), logger });

  if (dashboard) {
    app.route(config.http.routes.queueDashboard, dashboard);
  }

  app.notFound(notFoundHandler);
  app.onError(createErrorHandler(logger));

  return app;
}

/**
 * A grant, obtained the way the Operations page obtains one, as a `Cookie` header.
 *
 * Minted through a throwaway route rather than hand-rolled, because the signature is the whole point:
 * a fixture that built the cookie itself would pass while the real signing was broken.
 */
async function grantedCookie(session: OpsSession): Promise<string> {
  const issuer = new Hono();
  issuer.get("/", async (c) => {
    await session.grant(c);
    return c.body(null, 204);
  });

  const setCookie = (await issuer.request("/")).headers.get("set-cookie") ?? "";

  // Just the name=value pair; the attributes after the first `;` are the browser's business.
  return setCookie.split(";")[0] ?? "";
}

describe("the queue dashboard is off unless a deployment configures it", () => {
  test("no operator session means no routes at all", () => {
    expect(createQueueDashboardRoutes({ opsSession: undefined, redis: fakeRedis(), logger })).toBeUndefined();
  });

  test("an unconfigured deployment does not advertise that the route exists", async () => {
    const response = await mountDashboard(undefined).request(config.http.routes.queueDashboard);

    // The ordinary 404, indistinguishable from any other path that is not a route. A 403 would confirm
    // the dashboard is there and only the password is missing.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("the queue dashboard refuses anyone without a grant", () => {
  test("a browser navigating in is sent to the page that can unlock it", async () => {
    const response = await mountDashboard(opsSession()).request(config.http.routes.queueDashboard, HTML_REQUEST);

    // Not a bare 401: arriving at an error with no way forward is the problem the Operations page
    // exists to solve.
    expect(response.status).toBe(303);
    // Relative, which is what keeps it correct behind the web app's proxy: the API does not know the
    // public origin, and resolving against one it guessed would send the browser somewhere else.
    expect(response.headers.get("location")).toBe(config.webClient.routes.operations);
  });

  test("the dashboard's own API gets a 401 rather than a redirect", async () => {
    // Following a redirect would hand a fetch an HTML page, which is a more confusing failure than a
    // status code.
    const response = await mountDashboard(opsSession()).request(`${config.http.routes.queueDashboard}/api/queues`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  test("the static bundle is behind the gate too, not just the page", async () => {
    // The assets are reachable directly, and the JSON endpoints behind them more so — the guard is on
    // the wildcard rather than on the entry route for exactly this reason.
    const response = await mountDashboard(opsSession()).request(
      `${config.http.routes.queueDashboard}/static/js/main.js`,
    );

    expect(response.status).toBe(401);
  });

  test("a forged cookie is no better than none", async () => {
    const response = await mountDashboard(opsSession()).request(config.http.routes.queueDashboard, {
      headers: { ...HTML_REQUEST.headers, Cookie: `${config.ops.queueDashboard.session.cookieName}=${Date.now()}` },
    });

    expect(response.status).toBe(303);
  });

  test("a grant signed for a different password is refused", async () => {
    // Why the password is mixed into the signing key: rotating it has to invalidate what was already
    // handed out, or rotation achieves nothing.
    const cookie = await grantedCookie(opsSession({ password: "the-old-operator-password" }));
    const response = await mountDashboard(opsSession()).request(config.http.routes.queueDashboard, {
      headers: { ...HTML_REQUEST.headers, Cookie: cookie },
    });

    expect(response.status).toBe(303);
  });
});

describe("the queue dashboard serves its shell to a caller with a grant", () => {
  test("the entry point renders as HTML", async () => {
    const session = opsSession();
    const response = await mountDashboard(session).request(config.http.routes.queueDashboard, {
      headers: { ...HTML_REQUEST.headers, Cookie: await grantedCookie(session) },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("the shell resolves its assets against the path it is mounted at", async () => {
    // The `<base href>` is what makes the bundle load through the web app's proxy without the API
    // knowing its own public address. If the base path were wrong, the page would render and every
    // script it asks for would 404.
    const session = opsSession();
    const response = await mountDashboard(session).request(config.http.routes.queueDashboard, {
      headers: { ...HTML_REQUEST.headers, Cookie: await grantedCookie(session) },
    });

    expect(await response.text()).toContain(`<base href="${config.http.routes.queueDashboard}/" />`);
  });

  test("a trailing slash reaches the dashboard rather than the API's 404", async () => {
    const session = opsSession();
    const response = await mountDashboard(session).request(`${config.http.routes.queueDashboard}/`, {
      headers: { ...HTML_REQUEST.headers, Cookie: await grantedCookie(session) },
    });

    expect(response.status).toBe(301);
    // Absolute, as Hono writes it — the assertion is about the path, which is what has to lose the
    // slash and keep the prefix.
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(config.http.routes.queueDashboard);
  });

  test("a trailing slash without a grant is still turned away", async () => {
    // The redirect runs after the guard, so it cannot become a way to learn the route exists.
    const response = await mountDashboard(opsSession()).request(`${config.http.routes.queueDashboard}/`, HTML_REQUEST);

    expect(response.status).toBe(303);
  });
});
