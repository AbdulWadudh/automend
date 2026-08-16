/**
 * Every edit the builder can make to a flow definition, as pure functions.
 *
 * The canvas component holds one piece of state — the definition — and each interaction produces
 * the next one. Keeping the rules here rather than inside event handlers means they can be tested
 * without a browser, which is where the value is: node placement, edge cleanup when a step is
 * deleted, and never producing a graph the API's schema would reject.
 */

import {
  config,
  type FlowDefinition,
  type FlowEdge,
  type FlowStepConfig,
  type FlowStepKind,
  type FlowStepNode,
  type FlowTriggerConfig,
  type FlowTriggerKind,
} from "@automend/shared";
import { createStepConfig, createTriggerConfig, STEP_KIND_LABELS } from "./flow-kinds";

const { canvas } = config.flows;

export type FlowNodePosition = { x: number; y: number };

/** Any node on the canvas, so callers that do not care which end they are holding need no union. */
export type FlowAnyNode = FlowDefinition["trigger"] | FlowStepNode;

export function listNodes(definition: FlowDefinition): FlowAnyNode[] {
  return [definition.trigger, ...definition.steps];
}

export function findNode(definition: FlowDefinition, nodeId: string): FlowAnyNode | undefined {
  return listNodes(definition).find((node) => node.id === nodeId);
}

export function isTrigger(definition: FlowDefinition, nodeId: string): boolean {
  return definition.trigger.id === nodeId;
}

function isOccupied(definition: FlowDefinition, position: FlowNodePosition): boolean {
  return listNodes(definition).some((node) => node.position.x === position.x && node.position.y === position.y);
}

/**
 * Below the lowest node, nudged sideways if something is already there.
 *
 * A new step has to land somewhere predictable and visible; stacking downwards matches the way a
 * flow reads, and the sideways nudge stops two steps added in a row from hiding one another.
 */
export function nextNodePosition(definition: FlowDefinition): FlowNodePosition {
  let lowest = definition.trigger.position;

  for (const node of definition.steps) {
    if (node.position.y > lowest.y) {
      lowest = node.position;
    }
  }

  const position = {
    x: lowest.x + canvas.stepSpacing.x,
    y: lowest.y + canvas.stepSpacing.y,
  };

  while (isOccupied(definition, position)) {
    position.x += canvas.collisionOffset.x;
    position.y += canvas.collisionOffset.y;
  }

  return position;
}

export type AddStepOptions = {
  /** Where to drop it. Defaults to below the lowest node — see `nextNodePosition`. */
  position?: FlowNodePosition;
  /**
   * The node to wire it to. Set when the author dragged a connection out and released it on empty
   * canvas: they have already said where it comes from, so no guessing is involved.
   */
  connectFrom?: string;
};

/**
 * Adds a step and, when there is an obvious place for it, wires it in.
 *
 * With `connectFrom` the source is explicit. Without it, "obvious" means exactly one node has no
 * outgoing edge — the end of a straight chain. With a branch there is no single right answer, so
 * the step is left unconnected rather than being attached somewhere nobody asked for.
 */
export function addStep(
  definition: FlowDefinition,
  kind: FlowStepKind,
  options: AddStepOptions = {},
): { definition: FlowDefinition; stepId: string } {
  const step: FlowStepNode = {
    id: crypto.randomUUID(),
    name: STEP_KIND_LABELS[kind],
    position: options.position ?? nextNodePosition(definition),
    config: createStepConfig(kind),
  };

  const withStep: FlowDefinition = { ...definition, steps: [...definition.steps, step] };
  const source = options.connectFrom ?? findSoleOpenEnd(definition)?.id;

  if (!source || !listNodes(definition).some((node) => node.id === source)) {
    return { definition: withStep, stepId: step.id };
  }

  return {
    definition: { ...withStep, edges: [...withStep.edges, createEdge(source, step.id)] },
    stepId: step.id,
  };
}

/** The one node nothing runs after, if there is exactly one. */
function findSoleOpenEnd(definition: FlowDefinition): FlowAnyNode | undefined {
  const openEnds = listNodes(definition).filter((node) => !definition.edges.some((edge) => edge.source === node.id));

  return openEnds.length === 1 ? openEnds[0] : undefined;
}

/**
 * Copies a step, offset so it does not land on top of the original, and leaves it unconnected —
 * duplicating a step says nothing about where it belongs in the graph.
 */
export function duplicateStep(
  definition: FlowDefinition,
  stepId: string,
): { definition: FlowDefinition; stepId: string } | undefined {
  const original = definition.steps.find((step) => step.id === stepId);

  if (!original || definition.steps.length >= config.flows.maxSteps) {
    return undefined;
  }

  const copy: FlowStepNode = {
    ...original,
    id: crypto.randomUUID(),
    position: {
      x: original.position.x + canvas.collisionOffset.x,
      y: original.position.y + canvas.stepSpacing.y,
    },
  };

  return { definition: { ...definition, steps: [...definition.steps, copy] }, stepId: copy.id };
}

function createEdge(source: string, target: string): FlowEdge {
  return { id: crypto.randomUUID(), source, target };
}

/** Edges touching a removed step go with it, or the definition would reference a node that is gone. */
export function removeStep(definition: FlowDefinition, stepId: string): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.filter((step) => step.id !== stepId),
    edges: definition.edges.filter((edge) => edge.source !== stepId && edge.target !== stepId),
  };
}

export function renameNode(definition: FlowDefinition, nodeId: string, name: string): FlowDefinition {
  if (isTrigger(definition, nodeId)) {
    return { ...definition, trigger: { ...definition.trigger, name } };
  }

  return {
    ...definition,
    steps: definition.steps.map((step) => (step.id === nodeId ? { ...step, name } : step)),
  };
}

export function setTriggerConfig(definition: FlowDefinition, triggerConfig: FlowTriggerConfig): FlowDefinition {
  return { ...definition, trigger: { ...definition.trigger, config: triggerConfig } };
}

export function setTriggerKind(definition: FlowDefinition, kind: FlowTriggerKind): FlowDefinition {
  if (definition.trigger.config.kind === kind) {
    return definition;
  }

  return setTriggerConfig(definition, createTriggerConfig(kind));
}

export function setStepConfig(definition: FlowDefinition, stepId: string, stepConfig: FlowStepConfig): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) => (step.id === stepId ? { ...step, config: stepConfig } : step)),
  };
}

/** Switching kind replaces the whole configuration: a delay has no URL to carry over. */
export function setStepKind(definition: FlowDefinition, stepId: string, kind: FlowStepKind): FlowDefinition {
  const step = definition.steps.find((candidate) => candidate.id === stepId);

  if (!step || step.config.kind === kind) {
    return definition;
  }

  return setStepConfig(definition, stepId, createStepConfig(kind));
}

export function moveNode(definition: FlowDefinition, nodeId: string, position: FlowNodePosition): FlowDefinition {
  if (isTrigger(definition, nodeId)) {
    return { ...definition, trigger: { ...definition.trigger, position } };
  }

  return {
    ...definition,
    steps: definition.steps.map((step) => (step.id === nodeId ? { ...step, position } : step)),
  };
}

/**
 * Refuses the connections the API's schema would reject anyway — into the trigger, to itself, or a
 * duplicate — so the canvas simply does not draw them instead of failing on save.
 */
export function connectNodes(definition: FlowDefinition, source: string, target: string): FlowDefinition {
  const known = new Set(listNodes(definition).map((node) => node.id));
  const alreadyConnected = definition.edges.some((edge) => edge.source === source && edge.target === target);

  if (!known.has(source) || !known.has(target) || source === target || alreadyConnected) {
    return definition;
  }

  if (target === definition.trigger.id) {
    return definition;
  }

  if (wouldCreateCycle(definition, source, target)) {
    return definition;
  }

  return { ...definition, edges: [...definition.edges, createEdge(source, target)] };
}

/** A new edge closes a loop exactly when its target can already reach its source. */
function wouldCreateCycle(definition: FlowDefinition, source: string, target: string): boolean {
  const reachable = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.pop();

    if (current === undefined || reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    for (const edge of definition.edges) {
      if (edge.source === current) {
        queue.push(edge.target);
      }
    }
  }

  return reachable.has(source);
}

export function disconnect(definition: FlowDefinition, edgeId: string): FlowDefinition {
  return { ...definition, edges: definition.edges.filter((edge) => edge.id !== edgeId) };
}
