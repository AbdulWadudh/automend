/**
 * Turning a step's `connectionId` into a live credential.
 *
 * The test that matters most here is the provider id one, and it is a regression test. A Gmail step
 * failed in production with `"Send email" could not use its Gmail connection — Provider google is not
 * supported`, and the cause was a translation this module forgot to do:
 *
 * - a `connections` row stores the **connector** id, `google`, because that is the identifier the
 *   catalogue, the builder and every stored flow definition use;
 * - Better-Auth holds the linked account under the **suffixed** id, `google-connector`, so that
 *   authorising Google for automation cannot widen what signing in with Google is allowed to do;
 * - only the `google-connector` account carries a refresh token and the `gmail.send` scope. The
 *   sign-in account has neither, so even in a process that *did* register a `google` sign-in provider
 *   the bare id would resolve an account that cannot send an email and cannot be refreshed.
 *
 * A typecheck cannot see any of that: both ids are strings.
 */

import { describe, expect, test } from "bun:test";
import type { Auth } from "@automend/auth";
import type { Database } from "@automend/db";
import { createDefaultFlowDefinition, type FlowDefinition } from "@automend/shared";
import { resolveRunCredentials } from "../src/credentials";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const STEP_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_USER_ID = "44444444-4444-4444-8444-444444444444";

/** The Google account id Better-Auth stores for the connector, as it appears in the `account` table. */
const PROVIDER_ACCOUNT_ID = "111453116590250494252";

const secretsKey = Buffer.alloc(32, "k");

/** One Gmail step, which is the smallest definition that needs a credential at all. */
function gmailFlow(overrides: { connectionId?: string } = {}): FlowDefinition {
  const base = createDefaultFlowDefinition();

  return {
    ...base,
    steps: [
      {
        id: STEP_ID,
        name: "Send email",
        position: { x: 0, y: 200 },
        kitId: "gmail",
        actionName: "sendEmail",
        input: {},
        connectionId: "connectionId" in overrides ? overrides.connectionId : CONNECTION_ID,
        continueOnFailure: false,
      },
    ],
    edges: [{ id: crypto.randomUUID(), source: base.trigger.id, target: STEP_ID }],
  };
}

/** The four-call chain `findConnectionForTenant` builds, answering with one row. */
function databaseReturning(row: Record<string, unknown> | undefined): Database {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
  } as unknown as Database;
}

function oauthConnectionRow(providerId = "google") {
  return {
    id: CONNECTION_ID,
    tenantId: TENANT_ID,
    providerId,
    kind: "oauth",
    displayName: "Work mailbox",
    accountId: PROVIDER_ACCOUNT_ID,
    accountUserId: ACCOUNT_USER_ID,
  };
}

type GetAccessTokenCall = { providerId: string; accountId: string; userId: string };

/**
 * Records what was asked of Better-Auth.
 *
 * The point of these tests is the *request*, not the reply — asserting what the kit received would
 * pass while the wrong account was being asked for.
 */
function authRecording(calls: GetAccessTokenCall[], accessToken: string | null = "ya29.live-token"): Auth {
  return {
    api: {
      getAccessToken: async ({ body }: { body: GetAccessTokenCall }) => {
        calls.push(body);
        // `null`, not `undefined`: passing `undefined` to a defaulted parameter selects the default,
        // which would quietly turn "the provider gave us nothing" into the happy path.
        return accessToken === null ? null : { accessToken };
      },
    },
  } as unknown as Auth;
}

describe("resolving an OAuth connection", () => {
  test("asks Better-Auth for the connector account, not the sign-in one", async () => {
    const calls: GetAccessTokenCall[] = [];

    const result = await resolveRunCredentials({
      db: databaseReturning(oauthConnectionRow()),
      auth: authRecording(calls),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow(),
    });

    expect(result.ok).toBe(true);
    // The regression. `google` is not a provider the worker registers at all, and the account behind it
    // has no refresh token and no gmail.send scope.
    expect(calls).toEqual([
      { providerId: "google-connector", accountId: PROVIDER_ACCOUNT_ID, userId: ACCOUNT_USER_ID },
    ]);
  });

  test("hands the step the live access token under the connector id the kit knows", async () => {
    const result = await resolveRunCredentials({
      db: databaseReturning(oauthConnectionRow()),
      auth: authRecording([]),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow(),
    });

    if (!result.ok) {
      throw new Error(`expected the credentials to resolve, got: ${result.message}`);
    }

    // `connectorId` stays the *unsuffixed* id: that is what a kit declares in `kitOAuth`, and the suffix
    // is Better-Auth's business rather than the kit's.
    expect(result.credentials.get(STEP_ID)).toEqual({
      kind: "oauth",
      connectorId: "google",
      accessToken: "ya29.live-token",
    });
  });

  test("a provider that returns no token fails the step by name rather than silently", async () => {
    const result = await resolveRunCredentials({
      db: databaseReturning(oauthConnectionRow()),
      auth: authRecording([], null),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow(),
    });

    if (result.ok) {
      throw new Error("expected the credentials to fail");
    }

    expect(result.stepId).toBe(STEP_ID);
    expect(result.stepName).toBe("Send email");
    // The message a run stores and the UI shows, so it has to name the step and the service.
    expect(result.message).toContain("Send email");
    expect(result.message).toContain("Gmail");
    expect(result.message).toContain("re-authorising");
  });
});

describe("refusing to start a run that cannot get a credential", () => {
  test("a step with no connection chosen is reported before anything executes", async () => {
    // Resolved up front on purpose: a flow that sends an email and then posts to Slack must not send the
    // email if the Slack connection is gone. The partial run is the one nobody can undo.
    const result = await resolveRunCredentials({
      db: databaseReturning(undefined),
      auth: authRecording([]),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow({ connectionId: undefined }),
    });

    if (result.ok) {
      throw new Error("expected the credentials to fail");
    }

    expect(result.stepId).toBe(STEP_ID);
    expect(result.message).toContain("none is chosen");
  });

  test("a connection belonging to another workspace is absent, not borrowed", async () => {
    // `findConnectionForTenant` is scoped by tenant, so another workspace's connection gets the same
    // answer as one that never existed.
    const result = await resolveRunCredentials({
      db: databaseReturning(undefined),
      auth: authRecording([]),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow(),
    });

    if (result.ok) {
      throw new Error("expected the credentials to fail");
    }

    expect(result.message).toContain("no longer exists");
  });

  test("an OAuth connection whose account reference is gone says so", async () => {
    const result = await resolveRunCredentials({
      db: databaseReturning({ ...oauthConnectionRow(), accountId: null, accountUserId: null }),
      auth: authRecording([]),
      secretsKey,
      tenantId: TENANT_ID,
      definition: gmailFlow(),
    });

    if (result.ok) {
      throw new Error("expected the credentials to fail");
    }

    expect(result.message).toContain("no longer linked");
  });

  test("a step whose kit needs no credential is skipped rather than failed", async () => {
    const base = createDefaultFlowDefinition();
    const definition: FlowDefinition = {
      ...base,
      steps: [
        {
          id: STEP_ID,
          name: "Log it",
          position: { x: 0, y: 200 },
          kitId: "core",
          actionName: "log",
          input: {},
          continueOnFailure: false,
        },
      ],
      edges: [{ id: crypto.randomUUID(), source: base.trigger.id, target: STEP_ID }],
    };

    const calls: GetAccessTokenCall[] = [];
    const result = await resolveRunCredentials({
      db: databaseReturning(undefined),
      auth: authRecording(calls),
      secretsKey,
      tenantId: TENANT_ID,
      definition,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });
});
