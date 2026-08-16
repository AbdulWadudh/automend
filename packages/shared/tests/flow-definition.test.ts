import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import {
  createDefaultFlowDefinition,
  type FlowDefinition,
  type FlowStepNode,
  flowDefinitionSchema,
} from "../src/flow-definition";

/**
 * The graph rules are the highest-value logic in the package: they are what stops a definition
 * that cannot be executed from ever reaching the database, and the engine will trust them.
 */

function stepNode(overrides: Partial<FlowStepNode> = {}): FlowStepNode {
  return {
    id: crypto.randomUUID(),
    name: "Log something",
    position: { x: 0, y: 0 },
    config: { kind: "log", message: "hello" },
    ...overrides,
  };
}

function connect(source: string, target: string) {
  return { id: crypto.randomUUID(), source, target };
}

/** A trigger with `count` steps chained one after another, which is the shape most flows have. */
function linearDefinition(count: number): FlowDefinition {
  const definition = createDefaultFlowDefinition();
  const steps = Array.from({ length: count }, () => stepNode());

  definition.steps = steps;
  definition.edges = steps.map((step, index) =>
    connect(index === 0 ? definition.trigger.id : (steps[index - 1] as FlowStepNode).id, step.id),
  );

  return definition;
}

describe("a definition the builder can produce", () => {
  test("a brand-new flow is valid", () => {
    expect(flowDefinitionSchema.safeParse(createDefaultFlowDefinition()).success).toBe(true);
  });

  test("a chain of steps is valid", () => {
    expect(flowDefinitionSchema.safeParse(linearDefinition(3)).success).toBe(true);
  });

  test("a step that is not connected yet is still saveable", () => {
    // Adding a node before wiring it up is an ordinary editing state, not a broken flow.
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode()];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  test("two branches that rejoin are not mistaken for a loop", () => {
    const definition = createDefaultFlowDefinition();
    const left = stepNode();
    const right = stepNode();
    const merge = stepNode();

    definition.steps = [left, right, merge];
    definition.edges = [
      connect(definition.trigger.id, left.id),
      connect(definition.trigger.id, right.id),
      connect(left.id, merge.id),
      connect(right.id, merge.id),
    ];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(true);
  });
});

describe("graph rules", () => {
  test("an edge to a node that no longer exists is rejected", () => {
    const definition = createDefaultFlowDefinition();
    definition.edges = [connect(definition.trigger.id, crypto.randomUUID())];

    const result = flowDefinitionSchema.safeParse(definition);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("does not exist"))).toBe(true);
  });

  test("a step cannot connect to itself", () => {
    const definition = createDefaultFlowDefinition();
    const step = stepNode();

    definition.steps = [step];
    definition.edges = [connect(step.id, step.id)];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("nothing may connect into the trigger", () => {
    const definition = createDefaultFlowDefinition();
    const step = stepNode();

    definition.steps = [step];
    definition.edges = [connect(definition.trigger.id, step.id), connect(step.id, definition.trigger.id)];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("the same two nodes cannot be connected twice", () => {
    const definition = createDefaultFlowDefinition();
    const step = stepNode();

    definition.steps = [step];
    definition.edges = [connect(definition.trigger.id, step.id), connect(definition.trigger.id, step.id)];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("a cycle between steps is rejected", () => {
    const definition = createDefaultFlowDefinition();
    const first = stepNode();
    const second = stepNode();

    definition.steps = [first, second];
    definition.edges = [
      connect(definition.trigger.id, first.id),
      connect(first.id, second.id),
      connect(second.id, first.id),
    ];

    const result = flowDefinitionSchema.safeParse(definition);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("loop"))).toBe(true);
  });

  test("two nodes cannot share an id", () => {
    const definition = createDefaultFlowDefinition();
    const shared = crypto.randomUUID();

    definition.steps = [stepNode({ id: shared }), stepNode({ id: shared })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("more steps than the configured maximum are rejected", () => {
    expect(flowDefinitionSchema.safeParse(linearDefinition(config.flows.maxSteps)).success).toBe(true);
    expect(flowDefinitionSchema.safeParse(linearDefinition(config.flows.maxSteps + 1)).success).toBe(false);
  });
});

describe("step configuration", () => {
  test("an http step needs a real URL", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ config: { kind: "http-request", method: "GET", url: "not-a-url" } })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("a delay longer than the configured ceiling is rejected", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ config: { kind: "delay", durationMs: config.flows.delay.maxMs + 1 } })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("an unknown step kind is rejected", () => {
    const definition = createDefaultFlowDefinition();
    // Cast because the whole point is a value TypeScript would refuse — it models what an
    // untrusted request body can carry.
    definition.steps = [stepNode({ config: { kind: "run-arbitrary-code" } as unknown as FlowStepNode["config"] })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });
});

describe("the offered kinds and the accepted kinds cannot drift apart", () => {
  test("every step kind the builder offers is one the schema accepts", () => {
    for (const kind of config.flows.stepKinds) {
      const definition = createDefaultFlowDefinition();
      definition.steps = [stepNode({ config: exampleStepConfig(kind) })];

      const result = flowDefinitionSchema.safeParse(definition);

      expect(result.success).toBe(true);
    }
  });

  test("every trigger kind the builder offers is one the schema accepts", () => {
    for (const kind of config.flows.triggerKinds) {
      const definition = createDefaultFlowDefinition();
      definition.trigger.config = exampleTriggerConfig(kind);

      expect(flowDefinitionSchema.safeParse(definition).success).toBe(true);
    }
  });
});

function exampleStepConfig(kind: (typeof config.flows.stepKinds)[number]): FlowStepNode["config"] {
  switch (kind) {
    case "http-request":
      return { kind, method: config.flows.defaultHttpMethod, url: "https://example.com/hook" };
    case "send-email":
      return { kind, to: "someone@example.com", subject: "Hello", body: "Hi {{name}}" };
    case "delay":
      return { kind, durationMs: config.flows.delay.defaultMs };
    case "log":
      return { kind, message: "hello" };
  }
}

function exampleTriggerConfig(kind: (typeof config.flows.triggerKinds)[number]): FlowDefinition["trigger"]["config"] {
  switch (kind) {
    case "manual":
      return { kind };
    case "webhook":
      return { kind, path: "incoming" };
    case "schedule":
      return { kind, cron: "0 * * * *" };
  }
}
