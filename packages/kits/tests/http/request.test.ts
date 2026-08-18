import { describe, expect, test } from "bun:test";
import { httpRequestAction } from "../../src/http/actions/request";
import { createFakeContext, createFakeHttp, failure, ok } from "../support/fake-kit-context";

describe("http.request", () => {
  test("calls the URL with the method and body it was given", async () => {
    const http = createFakeHttp([ok({ ok: true })]);

    const output = await httpRequestAction.invoke(
      createFakeContext({
        http,
        input: { method: "POST", url: "https://example.com/hook", body: '{"a":1}' },
      }),
    );

    expect(http.calls[0]?.method).toBe("POST");
    expect(http.calls[0]?.url).toBe("https://example.com/hook");
    // `rawBody`, not `body`: the field is text the author wrote, sent as-is rather than re-encoded.
    expect(http.calls[0]?.rawBody).toBe('{"a":1}');
    expect(output).toEqual({ status: 200, headers: { "content-type": "application/json" }, body: { ok: true } });
  });

  /**
   * Reporting what a URL answered is the whole job of this action, so a 404 is a result rather than a
   * failure. Stopping the flow on an error status is the author's decision, made through the step's own
   * error handling.
   */
  test("returns a failing status rather than throwing", async () => {
    const http = createFakeHttp([failure(404, { error: "not found" })]);

    const output = await httpRequestAction.invoke(
      createFakeContext({ http, input: { method: "GET", url: "https://example.com/missing" } }),
    );

    expect(output).toMatchObject({ status: 404 });
  });

  describe("the headers field", () => {
    test("passes a JSON object through as headers", async () => {
      const http = createFakeHttp([ok({})]);

      await httpRequestAction.invoke(
        createFakeContext({
          http,
          input: { method: "GET", url: "https://example.com", headers: { authorization: "Bearer x" } },
        }),
      );

      expect(http.calls[0]?.headers).toEqual({ authorization: "Bearer x" });
    });

    /** `{"x-retry": 3}` is a reasonable thing to type, and refusing it would be pedantry. */
    test("stringifies a non-string value rather than rejecting it", async () => {
      const http = createFakeHttp([ok({})]);

      await httpRequestAction.invoke(
        createFakeContext({ http, input: { method: "GET", url: "https://example.com", headers: { "x-retry": 3 } } }),
      );

      expect(http.calls[0]?.headers).toEqual({ "x-retry": "3" });
    });

    /**
     * A `json` property resolves to `unknown`, so an author may well have typed an array or a number.
     * Sending that as headers is meaningless, and guessing at it would be worse than ignoring it.
     */
    test("ignores a value that is not an object", async () => {
      const http = createFakeHttp([ok({})]);

      await httpRequestAction.invoke(
        createFakeContext({ http, input: { method: "GET", url: "https://example.com", headers: [1, 2, 3] } }),
      );

      expect(http.calls[0]?.headers).toBeUndefined();
    });

    test("drops a null value instead of sending the text null", async () => {
      const http = createFakeHttp([ok({})]);

      await httpRequestAction.invoke(
        createFakeContext({
          http,
          input: { method: "GET", url: "https://example.com", headers: { "x-a": "1", "x-b": null } },
        }),
      );

      expect(http.calls[0]?.headers).toEqual({ "x-a": "1" });
    });
  });
});
