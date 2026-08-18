import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { createTrigger, isSchedulable } from "../src/trigger";
import { createFakeInvocation } from "./support/fake-invocation";

function invocation(payload: unknown) {
  return { ...createFakeInvocation(), payload };
}

describe("createTrigger", () => {
  test("passes the payload straight through when the kit does not say otherwise", async () => {
    const webhook = createTrigger({
      name: "incoming",
      displayName: "Incoming request",
      description: "Runs when the URL is called",
      strategy: "webhook",
      props: {},
      sampleData: {},
    });

    expect(await webhook.produce(invocation({ order: 1 }))).toEqual([{ order: 1 }]);
  });

  test("a kit that finds nothing produces nothing, and no run should follow", async () => {
    const polling = createTrigger({
      name: "newRows",
      displayName: "New rows",
      description: "Looks for rows",
      strategy: "polling",
      props: {},
      sampleData: {},
      produce: async () => [],
    });

    expect(await polling.produce(invocation(undefined))).toEqual([]);
  });

  test("enable and disable default to doing nothing, since most triggers register nothing", async () => {
    const manual = createTrigger({
      name: "manual",
      displayName: "Run manually",
      description: "Started by hand",
      strategy: "manual",
      props: {},
      sampleData: {},
    });

    expect(await manual.onEnable(invocation(undefined))).toBeUndefined();
    expect(await manual.onDisable(invocation(undefined))).toBeUndefined();
  });

  test("a declared hook is actually called", async () => {
    let enabled = false;

    const trigger = createTrigger({
      name: "watched",
      displayName: "Watched",
      description: "Subscribes upstream",
      strategy: "webhook",
      props: {},
      sampleData: {},
      onEnable: async () => {
        enabled = true;
      },
    });

    await trigger.onEnable(invocation(undefined));

    expect(enabled).toBe(true);
  });
});

/**
 * Until the scheduler exists, `polling` and `cron` are defined but cannot fire. The catalogue reports
 * that so the builder can refuse them with a reason, and this is the single switch that changes it.
 */
describe("which strategies this deployment can fire", () => {
  test("manual and webhook can", () => {
    expect(isSchedulable("manual")).toBe(true);
    expect(isSchedulable("webhook")).toBe(true);
  });

  test("polling and cron cannot, until the scheduler lands", () => {
    expect(isSchedulable("polling")).toBe(false);
    expect(isSchedulable("cron")).toBe(false);
  });

  test("every schedulable strategy is a real strategy", () => {
    const strategies: readonly string[] = config.kits.triggerStrategies;

    for (const strategy of config.kits.schedulableTriggerStrategies) {
      expect(strategies).toContain(strategy);
    }
  });
});
