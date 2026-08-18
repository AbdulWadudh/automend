import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/config";
import { forwardRequest } from "../src/http-proxy";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type FetchCall = { url: string; init: RequestInit };

function captureFetch(response: Response): FetchCall[] {
  const calls: FetchCall[] = [];

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;

  return calls;
}

describe("forwardRequest", () => {
  test("returns a redirect to the caller rather than following it", async () => {
    // What Better-Auth answers an OAuth callback with: the page to land on, and the session that
    // makes the user signed in. Followed here, the Location resolves against the API's own address
    // — which serves no such page — and the cookie is lost with the response that carried it.
    const upstream = new Response(null, {
      status: 302,
      headers: { location: "/app/flows", "set-cookie": "session=abc; HttpOnly" },
    });
    const calls = captureFetch(upstream);

    const response = await forwardRequest(
      new Request("https://web.example.com/api/v1/auth/callback/google"),
      new URL("http://api:3000/api/v1/auth/callback/google"),
    );

    expect(calls[0]?.init.redirect).toBe("manual");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/flows");
    expect(response.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
  });

  test("drops the headers that describe the inbound connection, and keeps the session", async () => {
    const calls = captureFetch(new Response("ok"));

    await forwardRequest(
      new Request("https://web.example.com/api/v1/flows", {
        headers: { "keep-alive": "timeout=5", cookie: "session=abc" },
      }),
      new URL("http://api:3000/api/v1/flows"),
    );

    const sent = new Headers(calls[0]?.init.headers);

    for (const header of config.http.proxy.strippedRequestHeaders) {
      expect(sent.has(header)).toBe(false);
    }

    expect(sent.get("cookie")).toBe("session=abc");
  });
});
