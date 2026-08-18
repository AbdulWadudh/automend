/**
 * `/api/v1/operations` — what the Operations page reads, and where the operator password is presented.
 *
 * These endpoints sit behind the ordinary user session, and that is not what authorises a console — it
 * narrows *who can try*. What the tests below are about is the layer above it: that a signed-in user is
 * still not admitted, that "unconfigured" and "wrong password" are answered identically, and that a
 * grant is what the page gets back.
 *
 * Whether a cookie resolves to a workspace is `packages/auth`'s business and is tested there, so it is
 * doubled here — but doubled *behind* the real middleware rather than in place of it, so these tests
 * would notice if the session requirement were ever removed.
 */

import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import { Hono } from "hono";
import type { ApiDependencies } from "../../src/dependencies";
import { createErrorHandler, notFoundHandler } from "../../src/http/error-handler";
import { createOpsSession, type OpsSession } from "../../src/http/ops-session";
import { createOperationsRoutes } from "../../src/routes/operations";

const OPERATOR_PASSWORD = "the-operator-password";
const SIGNING_SECRET = "s".repeat(config.auth.secretMinLength);

const CONSOLES_PATH = `${config.http.routes.operations}${config.http.routes.operationsConsoles}`;
const SESSION_PATH = `${config.http.routes.operations}${config.http.routes.operationsSession}`;

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function opsSession(password = OPERATOR_PASSWORD): OpsSession {
  return createOpsSession({ password, signingSecret: SIGNING_SECRET, secureCookie: false });
}

/** The same app with nobody signed in, to prove the session requirement is really there. */
function mountWithoutSession(): Hono {
  const deps = {
    opsSession: opsSession(),
    logger,
    auth: { api: { getSession: async () => null } },
    db: {},
  } as unknown as ApiDependencies;

  const app = new Hono();

  app.route(config.http.routes.operations, createOperationsRoutes(deps));
  app.onError(createErrorHandler(logger));

  return app;
}

/**
 * The routes, with the real session middleware in front of them.
 *
 * The middleware is satisfied rather than replaced: `createRequireSession` is installed by the route
 * factory itself, and stubbing it out would leave the tests unable to say whether these endpoints are
 * behind a session at all. So Better-Auth and the database are doubled just far enough to resolve one
 * fixed member of one fixed workspace.
 */
function mountOperations(options: { opsSession?: OpsSession; studioUrl?: string } = {}): Hono {
  const auth = {
    api: {
      getSession: async () => ({
        user: { id: "user-1" },
        session: { activeOrganizationId: "tenant-1" },
      }),
    },
  };

  // The four-call chain `isMemberOfOrganization` builds, answering "yes, a member".
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "member-1" }] }) }) }),
  };

  // Cast through `unknown`: ApiDependencies is the api's whole client surface, and these routes touch
  // four of its members — a faithful double would restate the entire type.
  const deps = {
    opsSession: options.opsSession,
    studioUrl: options.studioUrl,
    logger,
    auth,
    db,
  } as unknown as ApiDependencies;

  const app = new Hono();

  app.route(config.http.routes.operations, createOperationsRoutes(deps));
  app.notFound(notFoundHandler);
  app.onError(createErrorHandler(logger));

  return app;
}

async function readData(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as { data: Record<string, unknown> };
  return body.data;
}

describe("reporting which consoles this deployment has", () => {
  test("both unavailable when nothing is configured", async () => {
    const data = await readData(await mountOperations().request(CONSOLES_PATH));

    expect(data).toMatchObject({
      queues: { available: false, unlocked: false },
      database: { available: false, url: null },
    });
  });

  test("the queue console is available but locked before the password is presented", async () => {
    const data = await readData(await mountOperations({ opsSession: opsSession() }).request(CONSOLES_PATH));

    // Two flags rather than one: they call for completely different things on screen — an explanation
    // versus a link.
    expect(data.queues).toMatchObject({ available: true, unlocked: false });
  });

  test("the studio is reported with the address the deployment configured", async () => {
    // The API cannot derive it: the studio runs on its own origin, so it only knows what it was told.
    const studioUrl = "https://studio.example.com";
    const data = await readData(await mountOperations({ studioUrl }).request(CONSOLES_PATH));

    expect(data.database).toMatchObject({ available: true, url: studioUrl });
  });
});

describe("the endpoints are behind the ordinary session", () => {
  test("listing the consoles needs a signed-in user", async () => {
    // Not because a session authorises a console, but so an operator password is only ever offered to
    // somebody already signed in — the guess is not available to the open internet.
    expect((await mountWithoutSession().request(CONSOLES_PATH)).status).toBe(401);
  });

  test("presenting a password needs a signed-in user", async () => {
    const response = await mountWithoutSession().request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("presenting the operator password", () => {
  test("a signed-in user is not admitted without it", async () => {
    // The whole reason the console has a credential of its own: it reads across every tenant, so a
    // session scopes nothing.
    const data = await readData(await mountOperations({ opsSession: opsSession() }).request(CONSOLES_PATH));

    expect(data.queues).toMatchObject({ unlocked: false });
  });

  test("the right password is answered with a grant", async () => {
    const response = await mountOperations({ opsSession: opsSession() }).request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });

    expect(response.status).toBe(200);
    expect(await readData(response)).toMatchObject({ unlocked: true });
    expect(response.headers.get("set-cookie")).toContain(config.ops.queueDashboard.session.cookieName);
  });

  test("a wrong password is refused and hands out no cookie", async () => {
    const response = await mountOperations({ opsSession: opsSession() }).request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "not-the-operator-password" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("an unconfigured deployment refuses exactly the way a wrong password does", async () => {
    // Answered identically on purpose: with nothing configured there is no password that would work, and
    // distinguishing the cases tells a caller where to keep guessing.
    const response = await mountOperations().request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("an empty password is a validation failure, not a sign-in attempt", async () => {
    const response = await mountOperations({ opsSession: opsSession() }).request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });

    expect(response.status).toBe(400);
  });

  test("an overlong password is rejected before it is hashed", async () => {
    // Bounded so a request cannot be used to hand the api an arbitrarily large body to digest.
    const response = await mountOperations({ opsSession: opsSession() }).request(SESSION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(config.validation.opsPassword.maxLength + 1) }),
    });

    expect(response.status).toBe(400);
  });
});

describe("giving up a grant", () => {
  test("locking clears the cookie", async () => {
    const response = await mountOperations({ opsSession: opsSession() }).request(SESSION_PATH, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await readData(response)).toMatchObject({ unlocked: false });
    // An immediate expiry is how a cookie is deleted; there is no other mechanism.
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
