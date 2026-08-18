import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import {
  createDefaultFlowDefinition,
  type FlowDefinition,
  type FlowStepNode,
  flowDefinitionSchema,
} from "../src/flow-definition";

/**
 * The graph rules are the highest-value logic in the package: they are what stops a definition that could not
 * be executed from ever reaching the database, and the engine trusts them.
 *
 * What is *not* here is anything about whether `gmail.sendEmail` exists or whether its input suits it. This
 * module validates structure; the registry validates meaning, and it cannot be reached from here — the browser
 * imports this file, and `@automend/shared` depends on nothing. Those tests live in
 * `packages/kits/tests/validate-definition.test.ts`.
 */

function stepNode(overrides: Partial<FlowStepNode> = {}): FlowStepNode {
  return {
    id: crypto.randomUUID(),
    name: "Write to log",
    position: { x: 0, y: 0 },
    kitId: "core",
    actionName: "log",
    input: { message: "hello" },
    continueOnFailure: false,
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

describe("a step's shape", () => {
  test("a kit id and action name must be camelCase, matching what a kit can be called", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ kitId: "google-sheets" })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("an action name must be camelCase too", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ actionName: "send-email" })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  /**
   * Opaque here on purpose. Checking it against the action's property map is the registry's job, and a schema
   * in this file that knew about `gmail.sendEmail` would drag every kit's code into the browser bundle.
   */
  test("input is accepted as an opaque record, whatever the kit will make of it", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ input: { anything: "{{at.all}}", andANumber: 3 } })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  test("continueOnFailure defaults to stopping, which is the safe reading of an unset switch", () => {
    const definition = createDefaultFlowDefinition();
    const { continueOnFailure: _omitted, ...withoutSwitch } = stepNode();
    definition.steps = [withoutSwitch as FlowStepNode];

    const result = flowDefinitionSchema.safeParse(definition);

    expect(result.success).toBe(true);
    expect(result.data?.steps[0]?.continueOnFailure).toBe(false);
  });

  test("a connection is optional, because a step is configured before it is finished", () => {
    const definition = createDefaultFlowDefinition();
    definition.steps = [stepNode({ connectionId: undefined })];

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  test("a definition written at the previous version is not accepted here", () => {
    // `upgradeFlowDefinition` in `@automend/kits` is what reads those; this schema only knows the current one.
    const definition = { ...createDefaultFlowDefinition(), version: 1 };

    expect(flowDefinitionSchema.safeParse(definition).success).toBe(false);
  });
});

describe("a new flow", () => {
  test("starts on the trigger config says it should", () => {
    const definition = createDefaultFlowDefinition();

    expect(definition.trigger.kitId).toBe(config.flows.defaultTrigger.kitId);
    expect(definition.trigger.triggerName).toBe(config.flows.defaultTrigger.triggerName);
    expect(definition.version).toBe(config.flows.definitionVersion);
  });
});
