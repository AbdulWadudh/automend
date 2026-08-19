import { afterEach, describe, expect, test } from "bun:test";
import { exchangeSlackInstallCode, readSlackUserInfo } from "../src/slack";

type Recorded = { url: string; body: string; headers: Record<string, string> };

const realFetch = globalThis.fetch;

/** Returns the same payload to every call and records what was asked for. */
function stubFetch(payload: unknown): Recorded[] {
  const calls: Recorded[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const installed = {
  ok: true,
  access_token: "xoxb-bot",
  scope: "chat:write,chat:write.public",
  team: { id: "T1", name: "Light House" },
  authed_user: { id: "U1", access_token: "xoxp-user" },
};

describe("exchanging a Slack install code", () => {
  test("proves the exchange with the code verifier and never sends the client secret", async () => {
    const calls = stubFetch(installed);

    await exchangeSlackInstallCode("client-1")({
      code: "code-1",
      redirectURI: "https://automend.test/api/v1/auth/oauth2/callback/slack-connector",
      codeVerifier: "verifier-1",
    });

    const sent = new URLSearchParams(calls[0]?.body ?? "");

    expect(calls[0]?.url).toBe("https://slack.com/api/oauth.v2.access");
    expect(sent.get("client_id")).toBe("client-1");
    expect(sent.get("code")).toBe("code-1");
    expect(sent.get("code_verifier")).toBe("verifier-1");
    expect(sent.get("redirect_uri")).toBe("https://automend.test/api/v1/auth/oauth2/callback/slack-connector");
    // The whole point of PKCE here: the verifier replaces the secret rather than accompanying it.
    expect(sent.has("client_secret")).toBe(false);
  });

  /**
   * The bot token is the one every kit step is handed. Storing the user token instead would produce
   * a connection that stops working the moment the person who installed the app leaves.
   */
  test("stores the bot token, not the user token from the same install", async () => {
    stubFetch(installed);

    const tokens = await exchangeSlackInstallCode("client-1")({ code: "c", redirectURI: "r", codeVerifier: "v" });

    expect(tokens.accessToken).toBe("xoxb-bot");
    expect(tokens.scopes).toEqual(["chat:write", "chat:write.public"]);
  });

  /**
   * A non-rotating bot token does not expire, and inventing an expiry would send Better-Auth off to
   * refresh something Slack will not refresh.
   */
  test("leaves the expiry unset when the app is not opted into token rotation", async () => {
    stubFetch(installed);

    const tokens = await exchangeSlackInstallCode("client-1")({ code: "c", redirectURI: "r", codeVerifier: "v" });

    expect(tokens.accessTokenExpiresAt).toBeUndefined();
    expect(tokens.refreshToken).toBeUndefined();
  });

  test("carries the expiry and the refresh token through when rotation is on", async () => {
    stubFetch({ ...installed, expires_in: 43_200, refresh_token: "xoxe-1" });

    const tokens = await exchangeSlackInstallCode("client-1")({ code: "c", redirectURI: "r", codeVerifier: "v" });

    expect(tokens.refreshToken).toBe("xoxe-1");
    expect(tokens.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  /** Slack reports a refusal with HTTP 200, so a status check would call this a success. */
  test("a 200 carrying ok:false is a failure, quoting Slack's error", async () => {
    stubFetch({ ok: false, error: "invalid_code_verifier" });

    await expect(
      exchangeSlackInstallCode("client-1")({ code: "c", redirectURI: "r", codeVerifier: "v" }),
    ).rejects.toThrow(/invalid_code_verifier/);
  });
});

describe("identifying the installed workspace", () => {
  test("asks userInfo with the user token, because a bot token gets `not_authed`", async () => {
    const calls = stubFetch({
      "https://slack.com/user_id": "U1",
      "https://slack.com/team_name": "Light House",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada",
    });

    const info = await readSlackUserInfo({
      accessToken: "xoxb-bot",
      raw: installed as unknown as Record<string, unknown>,
    });

    expect(calls[0]?.url).toBe("https://slack.com/api/openid.connect.userInfo");
    expect(calls[0]?.headers.authorization).toBe("Bearer xoxp-user");
    // Named for the workspace: a list of connections showing workspaces says more than one showing people.
    expect(info).toMatchObject({ id: "U1", name: "Light House", email: "ada@example.com", emailVerified: true });
  });

  /** Granting the bot scopes but not the user ones leaves nothing to identify the connection with. */
  test("returns nothing when the install carried no user token", async () => {
    stubFetch({ email: "ada@example.com" });

    const info = await readSlackUserInfo({ accessToken: "xoxb-bot", raw: { ok: true, access_token: "xoxb-bot" } });

    expect(info).toBeNull();
  });

  /** The callback refuses a connection without an email, and saying so here is the honest failure. */
  test("returns nothing when Slack answers without an email", async () => {
    stubFetch({ "https://slack.com/user_id": "U1", name: "Ada" });

    const info = await readSlackUserInfo({
      accessToken: "xoxb-bot",
      raw: installed as unknown as Record<string, unknown>,
    });

    expect(info).toBeNull();
  });
});
