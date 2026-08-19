import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { loadChannelOptions } from "../../src/slack/common/channels";
import { createFakeHttp, createFakeOptionsContext, ok, slackOAuth } from "../support/fake-kit-context";

function page(channels: unknown[], nextCursor = "") {
  return ok({ ok: true, channels, response_metadata: { next_cursor: nextCursor } });
}

describe("listing Slack channels for the picker", () => {
  test("asks for both channel kinds, excluding archived, with the connection's token", async () => {
    const http = createFakeHttp([page([{ id: "C1", name: "general" }])]);

    await loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }));

    const call = http.calls[0];

    expect(call?.url).toBe("https://slack.com/api/conversations.list");
    expect(call?.headers?.authorization).toBe("Bearer test-bot-token");
    expect(call?.query).toMatchObject({ types: "public_channel,private_channel", exclude_archived: true });
  });

  /**
   * "private" is a separate qualifier rather than part of the name, so the builder can style it as
   * secondary, search it, and pair it with an icon — a channel is never told apart by a glyph alone.
   */
  test("names a channel the way Slack writes it and qualifies a private one separately", async () => {
    const http = createFakeHttp([
      page([
        { id: "C1", name: "general" },
        { id: "C2", name: "founders", is_private: true },
      ]),
    ]);

    const options = await loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }));

    expect(options).toEqual([
      { label: "#founders", value: "C2", description: "private" },
      { label: "#general", value: "C1", description: undefined },
    ]);
  });

  /**
   * The reason this paginates at all: Slack's pages are not alphabetical across the whole workspace,
   * so stopping after the first would hide channels in an order nobody could predict.
   */
  test("follows the cursor until Slack stops sending one", async () => {
    const http = createFakeHttp([
      page([{ id: "C1", name: "alpha" }], "cursor-2"),
      page([{ id: "C2", name: "beta" }], ""),
    ]);

    const options = await loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }));

    expect(http.calls).toHaveLength(2);
    expect(http.calls[0]?.query).not.toHaveProperty("cursor");
    expect(http.calls[1]?.query).toMatchObject({ cursor: "cursor-2" });
    expect(options.map((option) => option.value)).toEqual(["C1", "C2"]);
  });

  /** An empty string is Slack's "no more pages", not a cursor to ask for. */
  test("treats an empty cursor as the end rather than paging forever", async () => {
    const http = createFakeHttp([page([{ id: "C1", name: "general" }], "")]);

    await loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }));

    expect(http.calls).toHaveLength(1);
  });

  test("stops at the platform's cap rather than following a workspace's every page", async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({ id: `C${index}`, name: `channel-${index}` }));
    const http = createFakeHttp([page(full, "more")]);

    const options = await loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }));

    expect(options.length).toBeLessThanOrEqual(config.kits.maxDynamicOptions);
    expect(http.calls.length).toBeLessThanOrEqual(Math.ceil(config.kits.maxDynamicOptions / 200));
  });

  describe("when something is wrong", () => {
    /** Returning an empty list would read as "this workspace has no channels", which is a lie. */
    test("no connection fails rather than reporting no channels", async () => {
      const http = createFakeHttp([page([])]);

      await expect(loadChannelOptions(createFakeOptionsContext({ http }))).rejects.toThrow(/connected Slack/);
    });

    test("a refusal carries Slack's own error code, because the fix is usually a scope", async () => {
      const http = createFakeHttp([ok({ ok: false, error: "missing_scope" })]);

      await expect(loadChannelOptions(createFakeOptionsContext({ http, auth: slackOAuth }))).rejects.toThrow(
        /missing_scope/,
      );
    });
  });
});
