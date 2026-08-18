import { describe, expect, test } from "bun:test";
import { createDefaultFlowDefinition, type FlowDefinition, type FlowStepNode } from "@automend/shared";
import { planExecutionOrder } from "../../src/engine/executor";

/**
 * The order steps run in.
 *
 * Pure, so it is testable without a database or a subprocess — which is why the walk lives in the parent rather
 * than inside the engine. The interesting cases are the shapes a builder can actually produce: a chain, a branch,
 * a diamond, and a step somebody added and never connected.
 */

function step(name: string): FlowStepNode {
  return {
    id: crypto.randomUUID(),
    name,
    position: { x: 0, y: 0 },
    kitId: "core",
    actionName: "log",
    input: { message: name },
    continueOnFailure: false,
  };
}

function edge(source: string, target: string) {
  return { id: crypto.randomUUID(), source, target };
}

function flowOf(
  steps: FlowStepNode[],
  connect: (triggerId: string) => { id: string; source: string; target: string }[],
) {
  const definition: FlowDefinition = { ...createDefaultFlowDefinition(), steps };

  return { ...definition, edges: connect(definition.trigger.id) };
}

function namesOf(definition: FlowDefinition): string[] {
  return planExecutionOrder(definition).map((planned) => planned.name);
}

describe("a straight chain", () => {
  test("runs in the order it is wired, not the order it was added", () => {
    const [first, second, third] = [step("First"), step("Second"), step("Third")];
    // Deliberately listed out of order: the graph decides, not the array.
    const definition = flowOf([third, first, second], (triggerId) => [
      edge(triggerId, first.id),
      edge(first.id, second.id),
      edge(second.id, third.id),
    ]);

    expect(namesOf(definition)).toEqual(["First", "Second", "Third"]);
  });
});

describe("a branch", () => {
  test("both sides run, and each after the node it came from", () => {
    const [start, left, right] = [step("Start"), step("Left"), step("Right")];
    const definition = flowOf([start, left, right], (triggerId) => [
      edge(triggerId, start.id),
      edge(start.id, left.id),
      edge(start.id, right.id),
    ]);

    const order = namesOf(definition);

    expect(order).toHaveLength(3);
    expect(order[0]).toBe("Start");
    expect(order.slice(1).toSorted()).toEqual(["Left", "Right"]);
  });
});

describe("a diamond", () => {
  /**
   * The case a naive walk gets wrong: `Merge` has two things feeding it, and running it when the first arrives
   * would execute it before the other branch's output exists — which is exactly what its templates refer to.
   */
  test("the step where two branches rejoin waits for both", () => {
    const [left, right, merge] = [step("Left"), step("Right"), step("Merge")];
    const definition = flowOf([left, right, merge], (triggerId) => [
      edge(triggerId, left.id),
      edge(triggerId, right.id),
      edge(left.id, merge.id),
      edge(right.id, merge.id),
    ]);

    const order = namesOf(definition);

    expect(order).toHaveLength(3);
    expect(order.at(-1)).toBe("Merge");
  });
});

describe("what the trigger cannot reach", () => {
  /**
   * A step nothing connects to is an unfinished edit. Running it because it happens to exist would execute
   * something the author never wired up — and a `send email` step dragged onto the canvas and left alone would
   * send.
   */
  test("an unconnected step is not run at all", () => {
    const [connected, orphan] = [step("Connected"), step("Orphan")];
    const definition = flowOf([connected, orphan], (triggerId) => [edge(triggerId, connected.id)]);

    expect(namesOf(definition)).toEqual(["Connected"]);
  });

  test("a chain hanging off nothing is not run either", () => {
    const [orphan, afterOrphan] = [step("Orphan"), step("After orphan")];
    const definition = flowOf([orphan, afterOrphan], () => [edge(orphan.id, afterOrphan.id)]);

    expect(namesOf(definition)).toEqual([]);
  });
});

describe("degenerate shapes", () => {
  test("a flow with no steps plans nothing", () => {
    expect(planExecutionOrder(createDefaultFlowDefinition())).toEqual([]);
  });

  test("a step with several paths to it still runs once", () => {
    const [middle, end] = [step("Middle"), step("End")];
    const definition = flowOf([middle, end], (triggerId) => [
      edge(triggerId, middle.id),
      edge(triggerId, end.id),
      edge(middle.id, end.id),
    ]);

    const order = namesOf(definition);

    expect(order).toEqual(["Middle", "End"]);
    expect(new Set(order).size).toBe(order.length);
  });
});
