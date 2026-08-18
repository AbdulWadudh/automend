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
  setStepAction,
  setStepContinueOnFailure,
  setStepInput,
  setTriggerAction,
  setTriggerInput,
} from "../../src/lib/flow-editor";

/**
 * A step target as the catalogue would supply it.
 *
 * Written out here rather than fetched, because these tests are about the editing rules — the catalogue is the
 * API's business, and coupling them to it would mean a test that only passes with a server running.
 */
const LOG_STEP = { kitId: "core", actionName: "log", displayName: "Write to log", input: { message: "Step reached" } };
const DELAY_STEP = { kitId: "core", actionName: "delay", displayName: "Wait", input: { durationMs: "1000" } };
const EMAIL_STEP = {
  kitId: "gmail",
  actionName: "sendEmail",
  displayName: "Send email",
  input: { bodyType: "text" },
};
const WEBHOOK_TRIGGER = {
  kitId: "core",
  triggerName: "webhook",
  displayName: "Incoming webhook",
  input: { path: "incoming" },
};

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
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

    expect(definition.steps).toHaveLength(1);
    expect(definition.edges).toHaveLength(1);
    expect(definition.edges[0]?.target).toBe(stepId);
    expect(definition.edges[0]?.source).toBe(definition.trigger.id);
    expectValid(definition);
  });

  test("steps added one after another form a chain", () => {
    const targets = [LOG_STEP, DELAY_STEP, EMAIL_STEP];
    let definition = createDefaultFlowDefinition();

    for (const target of targets) {
      definition = addStep(definition, target).definition;
    }

    expect(definition.steps).toHaveLength(targets.length);
    expect(definition.edges).toHaveLength(targets.length);
    expectValid(definition);
  });

  test("a new step is named after the action, so it is never called nothing", () => {
    const { definition } = addStep(createDefaultFlowDefinition(), EMAIL_STEP);

    expect(definition.steps[0]?.name).toBe("Send email");
    expect(definition.steps[0]?.input).toEqual({ bodyType: "text" });
  });

  test("a step added to a branch is left unconnected rather than guessed at", () => {
    // Two steps hanging off the trigger leaves two open ends, so there is no single right place
    // to attach a third — the author decides.
    const first = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const second = addStep(first.definition, LOG_STEP);
    const branched = connectNodes(
      disconnect(second.definition, second.definition.edges[1]?.id ?? ""),
      second.definition.trigger.id,
      second.stepId,
    );

    const third = addStep(branched, DELAY_STEP);

    expect(third.definition.edges).toHaveLength(branched.edges.length);
    expectValid(third.definition);
  });

  test("a new step never lands on top of an existing one", () => {
    let definition = createDefaultFlowDefinition();

    for (let index = 0; index < 5; index += 1) {
      definition = addStep(definition, LOG_STEP).definition;
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
    const first = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const second = addStep(first.definition, DELAY_STEP);

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
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

    expect(connectNodes(definition, stepId, definition.trigger.id)).toBe(definition);
  });

  test("a node cannot be connected to itself", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

    expect(connectNodes(definition, stepId, stepId)).toBe(definition);
  });

  test("the same connection is not added twice", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

    expect(connectNodes(definition, definition.trigger.id, stepId)).toBe(definition);
  });

  test("a connection that would close a loop is refused", () => {
    const first = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const second = addStep(first.definition, LOG_STEP);

    // first -> second already exists, so second -> first would make the flow run forever.
    expect(connectNodes(second.definition, second.stepId, first.stepId)).toBe(second.definition);
  });

  test("a connection between unrelated nodes is added", () => {
    const first = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const second = addStep(first.definition, LOG_STEP);
    const unwired = disconnect(second.definition, second.definition.edges[1]?.id ?? "");

    const connected = connectNodes(unwired, first.stepId, second.stepId);

    expect(connected.edges).toHaveLength(unwired.edges.length + 1);
    expectValid(connected);
  });
});

describe("editing nodes", () => {
  test("pointing the trigger at another one replaces what it held", () => {
    const definition = setTriggerAction(createDefaultFlowDefinition(), WEBHOOK_TRIGGER);

    expect(definition.trigger.triggerName).toBe("webhook");
    expect(definition.trigger.input).toEqual({ path: "incoming" });
    expectValid(definition);
  });

  /**
   * Replacing rather than merging, for the same reason it was before kits: two actions that happen to share a
   * field name mean nothing by it, so carrying values across leaves an author with settings they never chose —
   * worse than an empty form, because it looks configured.
   */
  test("pointing a step at another action replaces its values rather than merging them", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), EMAIL_STEP);
    const changed = setStepAction(definition, stepId, DELAY_STEP);
    const step = changed.steps.find((candidate) => candidate.id === stepId);

    expect(step?.kitId).toBe("core");
    expect(step?.actionName).toBe("delay");
    expect(step?.input).toEqual({ durationMs: "1000" });
    expectValid(changed);
  });

  /** A connection belongs to the kit that needed it, so switching kit must not leave it pointing at nothing. */
  test("switching kit discards the connection the old kit was using", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), EMAIL_STEP);
    const connected = definition.steps.map((step) => ({ ...step, connectionId: crypto.randomUUID() }));
    const changed = setStepAction({ ...definition, steps: connected }, stepId, DELAY_STEP);

    expect(changed.steps[0]?.connectionId).toBeUndefined();
  });

  test("a name the author typed survives a change of action", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), EMAIL_STEP);
    const named = renameNode(definition, stepId, "Tell the customer");
    const changed = setStepAction(named, stepId, DELAY_STEP);

    expect(changed.steps[0]?.name).toBe("Tell the customer");
  });

  test("pointing a step at the action it already runs changes nothing", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const edited = setStepInput(definition, stepId, "message", "hand written");

    expect(setStepAction(edited, stepId, LOG_STEP)).toBe(edited);
  });

  test("setting a field records it, and clearing one removes the key entirely", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const set = setStepInput(definition, stepId, "message", "Order {{id}} received");

    expect(set.steps[0]?.input.message).toBe("Order {{id}} received");
    expectValid(set);

    // Cleared rather than stored as "": the engine treats blank as absent, so storing the empty string would
    // let a required field pass on save and fail at run time for a reason the builder never showed.
    const cleared = setStepInput(set, stepId, "message", "");

    expect(cleared.steps[0]?.input).not.toHaveProperty("message");
    expectValid(cleared);
  });

  test("a trigger's fields are set the same way", () => {
    const definition = setTriggerInput(
      setTriggerAction(createDefaultFlowDefinition(), WEBHOOK_TRIGGER),
      "path",
      "orders",
    );

    expect(definition.trigger.input.path).toBe("orders");
    expectValid(definition);
  });

  test("the failure switch is recorded, and defaults to stopping the run", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

    expect(definition.steps[0]?.continueOnFailure).toBe(false);

    const carryOn = setStepContinueOnFailure(definition, stepId, true);

    expect(carryOn.steps[0]?.continueOnFailure).toBe(true);
    expectValid(carryOn);
  });

  test("renaming reaches both the trigger and a step", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), LOG_STEP);

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
    const first = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const branch = addStep(first.definition, DELAY_STEP, {
      position: { x: 400, y: 200 },
      connectFrom: first.definition.trigger.id,
    });

    const fromTrigger = branch.definition.edges.filter((edge) => edge.source === branch.definition.trigger.id);

    expect(fromTrigger).toHaveLength(2);
    expect(branch.definition.steps.find((step) => step.id === branch.stepId)?.position).toEqual({ x: 400, y: 200 });
    expectValid(branch.definition);
  });

  test("a source that has since been deleted leaves the step unconnected rather than dangling", () => {
    const { definition } = addStep(createDefaultFlowDefinition(), LOG_STEP);
    const added = addStep(definition, LOG_STEP, { connectFrom: crypto.randomUUID() });

    expect(added.definition.edges.some((edge) => edge.target === added.stepId)).toBe(false);
    expectValid(added.definition);
  });
});

describe("duplicating a step", () => {
  test("copies the settings but not the connections", () => {
    const { definition, stepId } = addStep(createDefaultFlowDefinition(), EMAIL_STEP);
    const duplicated = duplicateStep(definition, stepId);

    const copy = duplicated?.definition.steps.find((step) => step.id === duplicated.stepId);
    const original = definition.steps.find((step) => step.id === stepId);

    expect(copy?.kitId).toBe(original?.kitId ?? "");
    expect(copy?.actionName).toBe(original?.actionName ?? "");
    expect(copy?.input).toEqual(original?.input ?? {});
    expect(duplicated?.definition.edges).toHaveLength(definition.edges.length);
    expect(copy?.position).not.toEqual(original?.position);
    expectValid(duplicated?.definition as FlowDefinition);
  });

  test("refuses once the flow is full, rather than producing an unsaveable definition", () => {
    let definition = createDefaultFlowDefinition();

    for (let index = 0; index < config.flows.maxSteps; index += 1) {
      definition = addStep(definition, LOG_STEP).definition;
    }

    expect(duplicateStep(definition, definition.steps[0]?.id ?? "")).toBeUndefined();
  });

  test("a node that does not exist cannot be duplicated", () => {
    expect(duplicateStep(createDefaultFlowDefinition(), crypto.randomUUID())).toBeUndefined();
  });
});
