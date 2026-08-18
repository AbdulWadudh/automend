import { describe, expect, test } from "bun:test";
import { config, createDefaultFlowDefinition, flowDefinitionSchema } from "@automend/shared";
import { isCurrentDefinition, upgradeFlowDefinition } from "../src/upgrade-definition";
import { validateDefinitionAgainstRegistry } from "../src/validate-definition";

/**
 * These run against a real v1 document — the exact shape the builder was writing before kits existed — rather
 * than against a hand-tuned fixture, because the whole value of an upgrade is that it reads what is actually
 * in the database.
 */

const triggerId = "11111111-1111-4111-8111-111111111111";
const httpStepId = "22222222-2222-4222-8222-222222222222";
const emailStepId = "33333333-3333-4333-8333-333333333333";
const delayStepId = "44444444-4444-4444-8444-444444444444";
const logStepId = "55555555-5555-4555-8555-555555555555";
const connectionId = "66666666-6666-4666-8666-666666666666";

function edge(source: string, target: string) {
  return { id: crypto.randomUUID(), source, target };
}

/**
 * Typed loosely on purpose: these tests mutate the fixture to reach the failure cases, and inferring a narrow
 * literal type from the happy path would make every one of those a type error rather than a test.
 */
type LegacyNodeFixture = {
  id: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

type LegacyFlowFixture = {
  version: number;
  trigger: LegacyNodeFixture;
  steps: LegacyNodeFixture[];
  edges: { id: string; source: string; target: string }[];
};

/** A v1 flow with one of every kind, wired trigger → http → email → delay → log. */
function legacyFlow(): LegacyFlowFixture {
  return {
    version: 1,
    trigger: {
      id: triggerId,
      name: "When a request arrives",
      position: { x: 0, y: 0 },
      config: { kind: "webhook", path: "incoming" },
    },
    steps: [
      {
        id: httpStepId,
        name: "Look up the order",
        position: { x: 0, y: 140 },
        config: { kind: "http-request", method: "POST", url: "https://example.com/orders" },
      },
      {
        id: emailStepId,
        name: "Tell the customer",
        position: { x: 0, y: 280 },
        config: {
          kind: "send-email",
          connectionId,
          to: "{{trigger.body.email}}",
          subject: "Order received",
          body: "Thanks!",
        },
      },
      {
        id: delayStepId,
        name: "Pause",
        position: { x: 0, y: 420 },
        config: { kind: "delay", durationMs: 1_000 },
      },
      {
        id: logStepId,
        name: "Note it",
        position: { x: 0, y: 560 },
        config: { kind: "log", message: "done" },
      },
    ],
    edges: [
      edge(triggerId, httpStepId),
      edge(httpStepId, emailStepId),
      edge(emailStepId, delayStepId),
      edge(delayStepId, logStepId),
    ],
  };
}

describe("reading a v1 flow", () => {
  const upgraded = upgradeFlowDefinition(legacyFlow());

  test("it comes back as a current definition the rest of the platform accepts", () => {
    expect(upgraded.version).toBe(config.flows.definitionVersion);
    expect(flowDefinitionSchema.safeParse(upgraded).success).toBe(true);
  });

  /** The old kinds were kebab-case and the new names are camelCase, so each of these is a real rename. */
  test("every v1 kind maps to the kit and action that replaced it", () => {
    expect(upgraded.trigger).toMatchObject({ kitId: "core", triggerName: "webhook" });
    expect(upgraded.steps.map((step) => `${step.kitId}.${step.actionName}`)).toEqual([
      "http.request",
      "gmail.sendEmail",
      "core.delay",
      "core.log",
    ]);
  });

  test("the mapped kits and actions all actually exist", () => {
    expect(validateDefinitionAgainstRegistry(upgraded)).toEqual([]);
  });

  test("each step's configured values survive under the same names", () => {
    expect(upgraded.trigger.input).toEqual({ path: "incoming" });
    expect(upgraded.steps[0]?.input).toEqual({ method: "POST", url: "https://example.com/orders" });
    expect(upgraded.steps[1]?.input).toEqual({
      to: "{{trigger.body.email}}",
      subject: "Order received",
      body: "Thanks!",
    });
    expect(upgraded.steps[3]?.input).toEqual({ message: "done" });
  });

  /**
   * The one genuine shape change between the versions, and the reason the upgrade has to consult the registry
   * rather than being pure data. v1 stored a duration as the number `1000`; a v2 templatable field is text at
   * rest, because a field that may hold `{{retryAfterMs}}` cannot be a number. Left as a number, the upgraded
   * flow would fail its own stored schema — which is exactly how this was found.
   */
  test("a v1 number becomes text, because v2 stores every templatable field as text", () => {
    expect(upgraded.steps[2]?.input).toEqual({ durationMs: "1000" });
  });

  test("and it still resolves back to the number the step needs at run time", async () => {
    const { buildResolvedInputSchema } = await import("@automend/kit-framework");
    const { findAction } = await import("../src/registry");
    const delay = findAction("core", "delay");
    const resolved = buildResolvedInputSchema(delay?.props ?? {}).safeParse(upgraded.steps[2]?.input);

    expect(resolved.success).toBe(true);
    expect((resolved.data as { durationMs: number } | undefined)?.durationMs).toBe(1_000);
  });

  /** v1 kept the connection inside a step's config; v2 promotes it, since any kit may need one. */
  test("a connection is promoted out of the step's values", () => {
    expect(upgraded.steps[1]?.connectionId).toBe(connectionId);
    expect(upgraded.steps[1]?.input).not.toHaveProperty("connectionId");
  });

  test("ids, names, positions and edges are preserved, so the canvas looks the same", () => {
    expect(upgraded.trigger.id).toBe(triggerId);
    expect(upgraded.trigger.name).toBe("When a request arrives");
    expect(upgraded.steps[0]?.position).toEqual({ x: 0, y: 140 });
    expect(upgraded.edges).toHaveLength(4);
  });

  /** v1 had no such switch, and the safe reading of a flow written before the choice existed is to stop. */
  test("a flow written before continueOnFailure existed does not silently gain it", () => {
    for (const step of upgraded.steps) {
      expect(step.continueOnFailure).toBe(false);
    }
  });

  test("every v1 trigger kind is handled", () => {
    for (const [kind, expected] of [
      ["manual", "core.manual"],
      ["webhook", "core.webhook"],
      ["schedule", "core.schedule"],
    ] as const) {
      const flow = legacyFlow();
      flow.trigger.config = { kind, path: "incoming" };

      const result = upgradeFlowDefinition(flow);

      expect(`${result.trigger.kitId}.${result.trigger.triggerName}`).toBe(expected);
    }
  });
});

describe("reading a current flow", () => {
  test("it is returned untouched rather than round-tripped through the upgrade", () => {
    const current = createDefaultFlowDefinition();

    expect(upgradeFlowDefinition(current)).toEqual(current);
    expect(isCurrentDefinition(current)).toBe(true);
    expect(isCurrentDefinition(legacyFlow())).toBe(false);
  });
});

describe("when a definition cannot be read", () => {
  /**
   * Refusing is the point. Executing half of somebody's flow is worse than refusing to execute it, and the API
   * surfaces this as a validation error naming the flow.
   */
  test("an unknown v1 step kind is refused rather than dropped", () => {
    const flow = legacyFlow();
    flow.steps[0] = {
      id: httpStepId,
      name: "Something removed",
      position: { x: 0, y: 140 },
      config: { kind: "transmogrify" },
    };

    expect(() => upgradeFlowDefinition(flow)).toThrow(/transmogrify/);
  });

  test("an unknown v1 trigger kind is refused too", () => {
    const flow = legacyFlow();
    flow.trigger.config = { kind: "telepathy", path: "x" };

    expect(() => upgradeFlowDefinition(flow)).toThrow(/telepathy/);
  });

  /**
   * A definition that is neither version is far more likely to be a v2 with a genuine problem than a v1, so the
   * message reports the v2 failure — telling a reader "version must be 1" would send them somewhere useless.
   */
  test("a definition of no recognisable version reports what is wrong with it as a current one", () => {
    expect(() => upgradeFlowDefinition({ version: 99, trigger: {}, steps: [], edges: [] })).toThrow(/cannot be read/);
    expect(() => upgradeFlowDefinition(null)).toThrow(/cannot be read/);
  });

  /** v1 enforced the same graph rules, so an upgrade must not be a way to smuggle a cycle past them. */
  test("a v1 flow whose graph was already broken does not become a valid v2 one", () => {
    const flow = legacyFlow();
    flow.edges.push(edge(logStepId, httpStepId));

    expect(() => upgradeFlowDefinition(flow)).toThrow();
  });
});
