import { describe, expect, test } from "bun:test";
import { slackSendMessageAction } from "../../src/slack/actions/send-message";
import { createFakeContext, createFakeHttp, failure, ok, slackOAuth } from "../support/fake-kit-context";

const input = {
  channel: "C0123ABCDEF",
  text: "Invoice 1024 has been paid.",
  replyBroadcast: false,
};

const posted = ok({ ok: true, channel: "C0123ABCDEF", ts: "1735689600.000100" });

describe("slack.sendMessage", () => {
  test("posts to chat.postMessage with the connection's bot token", async () => {
    const http = createFakeHttp([posted]);

    const output = await slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }));

    const call = http.calls[0];

    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(call?.headers?.authorization).toBe("Bearer test-bot-token");
    expect(call?.body).toMatchObject({ channel: "C0123ABCDEF", text: "Invoice 1024 has been paid." });
    expect(output).toMatchObject({ channel: "C0123ABCDEF", ts: "1735689600.000100" });
  });

  /** `thread_ts` on a message meant for the channel would silently bury it under an older one. */
  test("threads a reply only when the step names a message to reply to", async () => {
    const http = createFakeHttp([posted]);

    await slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }));

    expect(http.calls[0]?.body).not.toHaveProperty("thread_ts");

    const threaded = createFakeHttp([posted]);

    await slackSendMessageAction.invoke(
      createFakeContext({
        http: threaded,
        input: { ...input, threadTs: "1735689600.000001", replyBroadcast: true },
        auth: slackOAuth,
      }),
    );

    expect(threaded.calls[0]?.body).toMatchObject({ thread_ts: "1735689600.000001", reply_broadcast: true });
  });

  /** A step's output goes into the run journal, which is not a second copy of everything posted. */
  test("reports what was posted without echoing the message back into the journal", async () => {
    const http = createFakeHttp([posted]);

    const output = await slackSendMessageAction.invoke(
      createFakeContext({ http, input: { ...input, text: "Bank details: 1234" }, auth: slackOAuth }),
    );

    expect(JSON.stringify(output)).not.toContain("Bank details");
  });

  /** A reply's own `ts` is not the thread it belongs to, and a later step needs the thread. */
  test("hands a threaded reply back the thread it joined, not its own timestamp", async () => {
    const http = createFakeHttp([ok({ ok: true, channel: "C0123ABCDEF", ts: "1735689600.000200" })]);

    const output = await slackSendMessageAction.invoke(
      createFakeContext({ http, input: { ...input, threadTs: "1735689600.000001" }, auth: slackOAuth }),
    );

    expect(output).toMatchObject({ ts: "1735689600.000200", threadTs: "1735689600.000001" });
  });

  describe("when something is wrong", () => {
    test("no connection names the step, rather than failing somewhere upstream", async () => {
      const context = createFakeContext({ input, stepName: "Announce the payment" });

      await expect(slackSendMessageAction.invoke(context)).rejects.toThrow(/Announce the payment/);
    });

    /**
     * The one that matters most here: Slack answers a refusal with HTTP 200, so a step that posted
     * nothing would otherwise report success and the flow would carry on as though it had.
     */
    test("a 200 carrying ok:false is a failure, quoting Slack's own error code", async () => {
      const http = createFakeHttp([ok({ ok: false, error: "not_in_channel" })]);

      await expect(slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }))).rejects.toThrow(
        /not_in_channel/,
      );
    });

    test("a missing scope says so, because the fix is to reconnect rather than to edit the flow", async () => {
      const http = createFakeHttp([ok({ ok: false, error: "missing_scope" })]);

      await expect(slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }))).rejects.toThrow(
        /missing_scope/,
      );
    });

    test("an error status becomes a step failure naming the status", async () => {
      const http = createFakeHttp([failure(429, {})]);

      await expect(slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }))).rejects.toThrow(
        /HTTP 429/,
      );
    });

    test("a success Slack does not shape as expected fails rather than inventing a timestamp", async () => {
      const http = createFakeHttp([ok({ ok: true, channel: "C0123ABCDEF" })]);

      await expect(slackSendMessageAction.invoke(createFakeContext({ http, input, auth: slackOAuth }))).rejects.toThrow(
        /not the shape/,
      );
    });
  });
});
