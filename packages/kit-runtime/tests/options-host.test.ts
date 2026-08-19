import { describe, expect, test } from "bun:test";
import { loadDynamicOptions } from "../src/options-host";

/**
 * These spawn the real child. Every platform problem this engine has had — a broken IPC pipe on
 * Windows, a file URL's leading slash, a reader that would not release its lock — was found by
 * executing it rather than by reading it, so the boundary is exercised rather than faked.
 */
describe("loading options through the real subprocess", () => {
  test("a property that is not a dynamic dropdown fails instead of hanging", async () => {
    await expect(
      loadDynamicOptions({
        kitId: "slack",
        target: "action",
        targetName: "sendMessage",
        propertyName: "text",
        input: {},
        credential: null,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow(/no dynamic dropdown called text/);
  });

  test("an action the registry does not have fails by name", async () => {
    await expect(
      loadDynamicOptions({
        kitId: "slack",
        target: "action",
        targetName: "sendCarrierPigeon",
        propertyName: "channel",
        input: {},
        credential: null,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow(/sendCarrierPigeon/);
  });

  /**
   * The loader refuses without a credential, and that refusal has to travel back through the pipe as
   * a failure rather than as an empty list — "this workspace has no channels" would be a lie.
   */
  test("a kit's own refusal comes back as a failure, not as no options", async () => {
    await expect(
      loadDynamicOptions({
        kitId: "slack",
        target: "action",
        targetName: "sendMessage",
        propertyName: "channel",
        input: {},
        credential: null,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow(/connected Slack workspace/);
  });
});
