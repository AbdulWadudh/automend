import { describe, expect, test } from "bun:test";
import { buildResolvedInputSchema, buildStoredInputSchema } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { coreDelayAction } from "../../src/core/actions/delay";
import { coreLogAction } from "../../src/core/actions/log";
import { createFakeContext } from "../support/fake-kit-context";

describe("core.log", () => {
  test("writes the message it was given and reports it as the step output", async () => {
    const logged: string[] = [];
    const output = await coreLogAction.invoke(
      createFakeContext({ input: { message: "Order A-1024 received" }, logged }),
    );

    expect(logged).toEqual(["Order A-1024 received"]);
    expect(output).toEqual({ message: "Order A-1024 received" });
  });
});

describe("core.delay", () => {
  test("waits roughly the requested time and reports how long", async () => {
    const startedAt = Date.now();
    const output = await coreDelayAction.invoke(createFakeContext({ input: { durationMs: 20 } }));

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(output).toEqual({ waitedMs: 20 });
  });

  /**
   * The bound exists because a delay genuinely blocks its step — suspend and resume do not exist yet — so
   * a wait longer than the engine's step timeout would be killed mid-wait. `config.ts` derives the
   * maximum from that timeout; this checks the action actually applies it.
   */
  test("refuses a wait longer than its step could survive", () => {
    const resolved = buildResolvedInputSchema(coreDelayAction.props);

    expect(resolved.safeParse({ durationMs: String(config.flows.delay.maxMs) }).success).toBe(true);
    expect(resolved.safeParse({ durationMs: String(config.flows.delay.maxMs + 1) }).success).toBe(false);
  });

  test("refuses a negative wait", () => {
    expect(buildResolvedInputSchema(coreDelayAction.props).safeParse({ durationMs: "-1" }).success).toBe(false);
  });

  test("accepts a variable at rest, since the value is not known until the flow runs", () => {
    expect(buildStoredInputSchema(coreDelayAction.props).safeParse({ durationMs: "{{retryAfterMs}}" }).success).toBe(
      true,
    );
  });
});
