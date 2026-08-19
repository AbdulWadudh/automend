import { describe, expect, test } from "bun:test";
import { parseSlackBlocks } from "../../src/slack/common/blocks";

const section = { type: "section", text: { type: "mrkdwn", text: "Meet Asha" } };

describe("reading Block Kit out of what an author pasted", () => {
  /** What Slack's own Block Kit Builder copies to the clipboard, which is where these come from. */
  test("accepts the object the Block Kit Builder copies out", () => {
    expect(parseSlackBlocks({ blocks: [section] })).toEqual([section]);
  });

  test("accepts the bare array chat.postMessage actually takes", () => {
    expect(parseSlackBlocks([section])).toEqual([section]);
  });

  /**
   * Handed on untouched. A schema that rebuilt each block would drop every field it had not been
   * taught, and Slack adds block types faster than this kit will be edited.
   */
  test("passes fields it has never heard of straight through", () => {
    const exotic = { type: "video", video_url: "https://example.com/v.mp4", something_new: { nested: true } };

    expect(parseSlackBlocks([exotic])).toEqual([exotic]);
  });

  describe("when there is nothing to send", () => {
    /** An empty field is not a request to render nothing — Slack would post an empty message. */
    test.each([undefined, null, ""])("treats %p as no blocks at all", (value) => {
      expect(parseSlackBlocks(value)).toBeUndefined();
    });

    test("treats an empty array the same way, rather than posting a blank message", () => {
      expect(parseSlackBlocks([])).toBeUndefined();
      expect(parseSlackBlocks({ blocks: [] })).toBeUndefined();
    });
  });

  describe("when it is wrong", () => {
    test("says what shape it wanted rather than letting Slack answer invalid_blocks", () => {
      expect(() => parseSlackBlocks({ text: "not blocks" })).toThrow(/JSON array/);
      expect(() => parseSlackBlocks("just a string")).toThrow(/JSON array/);
    });

    /** A person looking at forty blocks needs to know which one, so the position is named. */
    test("names the offending block by position", () => {
      expect(() => parseSlackBlocks([section, { text: "no type here" }])).toThrow(/Block 2/);
      expect(() => parseSlackBlocks([section, "nope"])).toThrow(/Block 2/);
    });

    test("refuses more blocks than Slack accepts, and says the number", () => {
      const tooMany = Array.from({ length: 51 }, () => section);

      expect(() => parseSlackBlocks(tooMany)).toThrow(/at most 50 blocks/);
    });
  });
});
