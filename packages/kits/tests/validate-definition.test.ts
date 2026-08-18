import { describe, expect, test } from "bun:test";
import { createDefaultFlowDefinition, type FlowDefinition, type FlowStepNode } from "@automend/shared";
import {
  describeDefinitionIssues,
  findStepsMissingConnections,
  validateDefinitionAgainstRegistry,
} from "../src/validate-definition";

/**
 * The half of validation that `@automend/shared` cannot do, because it cannot reach the registry.
 *
 * The structural rules — node ids, the graph, the shape of a step — are tested in
 * `packages/shared/tests/flow-definition.test.ts`. These cover the questions that need to know what a kit *is*:
 * does this action exist, and do the values saved against it suit the fields it declared.
 */

function step(overrides: Partial<FlowStepNode> = {}): FlowStepNode {
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

function withSteps(...steps: FlowStepNode[]): FlowDefinition {
  const definition = createDefaultFlowDefinition();

  definition.steps = steps;

  return definition;
}

describe("a definition that names real things", () => {
  test("a new flow is valid", () => {
    expect(validateDefinitionAgainstRegistry(createDefaultFlowDefinition())).toEqual([]);
  });

  test("every shipped kit's actions validate with the values the builder would save", () => {
    const definition = withSteps(
      step({ kitId: "core", actionName: "log", input: { message: "hi" } }),
      step({ kitId: "core", actionName: "delay", input: { durationMs: "1000" } }),
      step({
        kitId: "http",
        actionName: "request",
        input: { method: "POST", url: "https://example.com", body: "{}" },
      }),
      step({
        kitId: "gmail",
        actionName: "sendEmail",
        input: { to: "ada@example.com", subject: "Hi", body: "There", bodyType: "text" },
      }),
    );

    expect(validateDefinitionAgainstRegistry(definition)).toEqual([]);
  });

  /** A half-configured step is a normal thing to save, and the builder must always be able to. */
  test("a step with nothing filled in yet is valid, because saving work in progress must always work", () => {
    expect(validateDefinitionAgainstRegistry(withSteps(step({ input: {} })))).toEqual([]);
  });

  test("a field holding a variable is valid, since it is text until the flow has data", () => {
    const definition = withSteps(step({ kitId: "core", actionName: "delay", input: { durationMs: "{{retryMs}}" } }));

    expect(validateDefinitionAgainstRegistry(definition)).toEqual([]);
  });
});

describe("a definition that names something that is not there", () => {
  test("an unknown kit is reported against the step, naming the kit", () => {
    const issues = validateDefinitionAgainstRegistry(withSteps(step({ kitId: "myspace" })));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("steps.0");
    expect(issues[0]?.message).toMatch(/no kit called "myspace"/);
  });

  /**
   * Worth distinguishing: a deleted kit and a renamed action need different fixes, and "unknown action" on a
   * kit that is gone reads as a typo when it is not.
   */
  test("a real kit with an unknown action says so differently", () => {
    const issues = validateDefinitionAgainstRegistry(withSteps(step({ actionName: "sendCarrierPigeon" })));

    expect(issues[0]?.message).toMatch(/"core" has no action called "sendCarrierPigeon"/);
  });

  test("an unknown trigger is reported against the trigger", () => {
    const definition = createDefaultFlowDefinition();
    definition.trigger.triggerName = "telepathy";

    const issues = validateDefinitionAgainstRegistry(definition);

    expect(issues[0]?.path).toBe("trigger");
    expect(issues[0]?.message).toMatch(/no trigger called "telepathy"/);
  });

  /** An action name is not a trigger name, even inside the same kit. */
  test("naming an action where a trigger belongs is refused", () => {
    const definition = createDefaultFlowDefinition();
    definition.trigger.kitId = "gmail";
    definition.trigger.triggerName = "sendEmail";

    expect(validateDefinitionAgainstRegistry(definition)).not.toEqual([]);
  });

  /**
   * Every problem at once, not the first. An author who renamed a kit should see every step that needs
   * attention rather than fixing them one save at a time.
   */
  test("every problem is reported, not just the first", () => {
    const definition = withSteps(step({ kitId: "myspace" }), step({ kitId: "friendster" }));
    definition.trigger.triggerName = "telepathy";

    const issues = validateDefinitionAgainstRegistry(definition);

    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path)).toEqual(["trigger", "steps.0", "steps.1"]);
  });
});

describe("a definition whose values do not suit the action", () => {
  test("a value of the wrong type for a non-templatable field is reported", () => {
    const definition = withSteps(step({ kitId: "gmail", actionName: "sendEmail", input: { bodyType: "semaphore" } }));
    const issues = validateDefinitionAgainstRegistry(definition);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("steps.0.input");
  });

  test("text beyond a field's length is reported, so one field cannot make an unloadable row", () => {
    const definition = withSteps(step({ input: { message: "x".repeat(200_000) } }));

    expect(validateDefinitionAgainstRegistry(definition)).not.toEqual([]);
  });

  test("a trigger's values are checked too", () => {
    const definition = createDefaultFlowDefinition();
    definition.trigger.triggerName = "webhook";
    definition.trigger.input = { path: 42 };

    const issues = validateDefinitionAgainstRegistry(definition);

    expect(issues[0]?.path).toBe("trigger.input");
  });
});

/**
 * Kept apart from the checks above because the answer is allowed to be no. A flow saved before its Google
 * account is connected is a normal state to be in; a *run* that reached such a step has to fail. So the API
 * calls the validator and the engine calls both.
 */
describe("steps that still need a connection", () => {
  test("a kit needing credentials without one is reported, naming the step", () => {
    const definition = withSteps(step({ kitId: "gmail", actionName: "sendEmail", name: "Send the receipt" }));
    const missing = findStepsMissingConnections(definition);

    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toMatch(/Send the receipt/);
  });

  test("but it is still valid to save", () => {
    const definition = withSteps(
      step({
        kitId: "gmail",
        actionName: "sendEmail",
        input: { to: "a@b.c", subject: "Hi", body: "There", bodyType: "text" },
      }),
    );

    expect(validateDefinitionAgainstRegistry(definition)).toEqual([]);
  });

  test("a connection satisfies it", () => {
    const definition = withSteps(step({ kitId: "gmail", actionName: "sendEmail", connectionId: crypto.randomUUID() }));

    expect(findStepsMissingConnections(definition)).toEqual([]);
  });

  test("a kit that needs no credentials never asks for one", () => {
    expect(findStepsMissingConnections(withSteps(step(), step({ kitId: "http", actionName: "request" })))).toEqual([]);
  });
});

describe("reporting issues to a person", () => {
  test("each one names the place it belongs to", () => {
    const described = describeDefinitionIssues([
      { path: "trigger", message: "no such trigger" },
      { path: "steps.1.input", message: "url is required" },
    ]);

    expect(described).toBe("trigger: no such trigger; steps.1.input: url is required");
  });
});
