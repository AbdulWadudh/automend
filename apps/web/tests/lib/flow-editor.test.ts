import { describe, expect, test } from "bun:test";
import { config, createDefaultFlowDefinition, type FlowDefinition, flowDefinitionSchema } from "@automend/shared";
import {
  addStep,
  connectNodes,
  disconnect,
  duplicateStep,
  listNodes,
  moveNode,
  nextNodePosition,
  removeStep,
  renameNode,
  setStepKind,
  setTriggerKind,
} from "../../src/lib/flow-editor";

/**
 * Every one of these asserts the same underlying property: whatever the builder does, the result
 * still passes the schema the API validates against. An edit that produces an unsaveable document
 * is the failure mode worth testing for.
 */
function expectValid(definition: FlowDefinition) {
  const result = flowDefinitionSchema.safeParse(definition);

  expect(result.error?.issues ?? []).toEqual([]);
  expect(result.success).toBe(true);
}

describe("adding steps", () => {
  test("a step added to a new flow is wired to the trigger", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "log");

    expect(definition.steps).toHaveLength(1);
    expect(definition.edges).toHaveLength(1);
    expect(definition.edges[0]?.target).toBe(stepId);
    expect(definition.edges[0]?.source).toBe(definition.trigger.id);
    expectValid(definition);
  });

  test("steps added one after another form a chain", () => {
    let definition = createDefaultFlowDefinition();

    for (const kind of config.flows.stepKinds) {
      definition = addStep(definition, kind).definition;
    }

    expect(definition.steps).toHaveLength(config.flows.stepKinds.length);
    expect(definition.edges).toHaveLength(config.flows.stepKinds.length);
    expectValid(definition);
  });

  test("a step added to a branch is left unconnected rather than guessed at", () => {
    // Two steps hanging off the trigger leaves two open ends, so there is no single right place
    // to attach a third — the author decides.
    const first = addStep(createDefaultFlowDefinition(), "log");
    const second = addStep(first.definition, "log");
    const branched = connectNodes(
      disconnect(second.definition, second.definition.edges[1]?.id ?? ""),
      second.definition.trigger.id,
      second.stepId,
    );

    const third = addStep(branched, "delay");

    expect(third.definition.edges).toHaveLength(branched.edges.length);
    expectValid(third.definition);
  });

  test("a new step never lands on top of an existing one", () => {
    let definition = createDefaultFlowDefinition();

    for (let index = 0; index < 5; index += 1) {
      definition = addStep(definition, "log").definition;
    }

    const positions = listNodes(definition).map((node) => `${node.position.x},${node.position.y}`);

    expect(new Set(positions).size).toBe(positions.length);
  });

  test("a position is still free when a node was dragged onto the default slot", () => {
    const definition = moveNode(createDefaultFlowDefinition(), createDefaultFlowDefinition().trigger.id, {
      x: 0,
      y: 0,
    });

    expect(nextNodePosition(definition)).not.toEqual(definition.trigger.position);
  });
});

describe("removing steps", () => {
  test("edges touching a removed step are removed with it", () => {
    const first = addStep(createDefaultFlowDefinition(), "log");
    const second = addStep(first.definition, "delay");

    const definition = removeStep(second.definition, first.stepId);

    expect(definition.steps).toHaveLength(1);
    // Both the edge into the removed step and the one out of it must go, or the definition would
    // reference a node that no longer exists.
    expect(definition.edges).toHaveLength(0);
    expectValid(definition);
  });
});

describe("connecting nodes", () => {
  test("a connection into the trigger is refused", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "log");

    expect(connectNodes(definition, stepId, definition.trigger.id)).toBe(definition);
  });

  test("a node cannot be connected to itself", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "log");

    expect(connectNodes(definition, stepId, stepId)).toBe(definition);
  });

  test("the same connection is not added twice", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "log");

    expect(connectNodes(definition, definition.trigger.id, stepId)).toBe(definition);
  });

  test("a connection that would close a loop is refused", () => {
    const first = addStep(createDefaultFlowDefinition(), "log");
    const second = addStep(first.definition, "log");

    // first -> second already exists, so second -> first would make the flow run forever.
    expect(connectNodes(second.definition, second.stepId, first.stepId)).toBe(second.definition);
  });

  test("a connection between unrelated nodes is added", () => {
    const first = addStep(createDefaultFlowDefinition(), "log");
    const second = addStep(first.definition, "log");
    const unwired = disconnect(second.definition, second.definition.edges[1]?.id ?? "");

    const connected = connectNodes(unwired, first.stepId, second.stepId);

    expect(connected.edges).toHaveLength(unwired.edges.length + 1);
    expectValid(connected);
  });
});

describe("editing nodes", () => {
  test("changing the trigger kind replaces its configuration", () => {
    const definition = setTriggerKind(createDefaultFlowDefinition(), "schedule");

    expect(definition.trigger.config.kind).toBe("schedule");
    expectValid(definition);
  });

  test("changing a step kind replaces its configuration rather than merging it", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "http-request");
    const changed = setStepKind(definition, stepId, "delay");
    const step = changed.steps.find((candidate) => candidate.id === stepId);

    // A delay has no URL to carry over from the request it replaced.
    expect(step?.config).toEqual({ kind: "delay", durationMs: config.flows.delay.defaultMs });
    expectValid(changed);
  });

  test("every kind the builder offers produces a saveable step", () => {
    for (const kind of config.flows.stepKinds) {
      expectValid(addStep(createDefaultFlowDefinition(), kind).definition);
    }
  });

  test("every trigger kind the builder offers produces a saveable flow", () => {
    for (const kind of config.flows.triggerKinds) {
      expectValid(setTriggerKind(createDefaultFlowDefinition(), kind));
    }
  });

  test("renaming reaches both the trigger and a step", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "log");

    expect(renameNode(definition, definition.trigger.id, "Kick off").trigger.name).toBe("Kick off");
    expect(renameNode(definition, stepId, "Say hello").steps[0]?.name).toBe("Say hello");
  });

  test("dragging a node records its new position", () => {
    const definition = moveNode(createDefaultFlowDefinition(), createDefaultFlowDefinition().trigger.id, {
      x: 10,
      y: 20,
    });

    expectValid(definition);
  });
});

describe("adding a step where a connection was dropped", () => {
  test("wires it to the node the connection came from, wherever the graph branches", () => {
    // Dragging from the trigger a second time is how a parallel branch is made, and it must not
    // be diverted to whatever happens to be the sole open end.
    const first = addStep(createDefaultFlowDefinition(), "log");
    const branch = addStep(first.definition, "delay", {
      position: { x: 400, y: 200 },
      connectFrom: first.definition.trigger.id,
    });

    const fromTrigger = branch.definition.edges.filter((edge) => edge.source === branch.definition.trigger.id);

    expect(fromTrigger).toHaveLength(2);
    expect(branch.definition.steps.find((step) => step.id === branch.stepId)?.position).toEqual({ x: 400, y: 200 });
    expectValid(branch.definition);
  });

  test("a source that has since been deleted leaves the step unconnected rather than dangling", () => {
    const { definition } = addStep(createDefaultFlowDefinition(), "log");
    const added = addStep(definition, "log", { connectFrom: crypto.randomUUID() });

    expect(added.definition.edges.some((edge) => edge.target === added.stepId)).toBe(false);
    expectValid(added.definition);
  });
});

describe("duplicating a step", () => {
  test("copies the settings but not the connections", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), "http-request");
    const duplicated = duplicateStep(definition, stepId);

    const copy = duplicated?.definition.steps.find((step) => step.id === duplicated.stepId);
    const original = definition.steps.find((step) => step.id === stepId);

    expect(copy?.config).toEqual(original?.config);
    expect(duplicated?.definition.edges).toHaveLength(definition.edges.length);
    expect(copy?.position).not.toEqual(original?.position);
    expectValid(duplicated?.definition as FlowDefinition);
  });

  test("refuses once the flow is full, rather than producing an unsaveable definition", () => {
    let definition = createDefaultFlowDefinition();

    for (let index = 0; index < config.flows.maxSteps; index += 1) {
      definition = addStep(definition, "log").definition;
    }

    expect(duplicateStep(definition, definition.steps[0]?.id ?? "")).toBeUndefined();
  });

  test("a node that does not exist cannot be duplicated", () => {
    expect(duplicateStep(createDefaultFlowDefinition(), crypto.randomUUID())).toBeUndefined();
  });
});
