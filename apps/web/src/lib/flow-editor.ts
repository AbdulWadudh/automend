/**
 * Every edit the builder can make to a flow definition, as pure functions.
 *
 * The canvas component holds one piece of state — the definition — and each interaction produces
 * the next one. Keeping the rules here rather than inside event handlers means they can be tested
 * without a browser, which is where the value is: node placement, edge cleanup when a step is
 * deleted, and never producing a graph the API's schema would reject.
 */

import { config, type FlowDefinition, type FlowEdge, type FlowStepNode } from "@automend/shared";

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

/**
 * Which action a step performs, and what it starts out holding.
 *
 * The defaults come from the catalogue rather than from a factory in this file. Before kits, adding a step meant
 * editing a `createStepConfig` switch here as well as the schema and three lookup maps; now the kit that
 * declared the fields is also what says what they start as, and the builder learns both over HTTP.
 */
export type StepTarget = {
  kitId: string;
  actionName: string;
  /** The kit author's name for it, used as the node's initial name so a new node is never called "Step". */
  displayName: string;
  input: Record<string, unknown>;
};

export type TriggerTarget = {
  kitId: string;
  triggerName: string;
  displayName: string;
  input: Record<string, unknown>;
};

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
  target: StepTarget,
  options: AddStepOptions = {},
): { definition: FlowDefinition; stepId: string } {
  const step: FlowStepNode = {
    id: crypto.randomUUID(),
    name: target.displayName,
    position: options.position ?? nextNodePosition(definition),
    kitId: target.kitId,
    actionName: target.actionName,
    input: target.input,
    continueOnFailure: false,
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

function mapStep(
  definition: FlowDefinition,
  stepId: string,
  change: (step: FlowStepNode) => FlowStepNode,
): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) => (step.id === stepId ? change(step) : step)),
  };
}

/**
 * Points a step at a different action, replacing what it held.
 *
 * Replacing rather than merging, and the reason is the same as it was before kits: a wait has no URL to carry
 * over. Two actions that happen to share a field name mean nothing by it, so keeping values across a switch
 * leaves an author with settings they never chose — worse than an empty form, because it looks configured.
 *
 * The node's name is left alone. It is the author's label for this step in their flow, not a restatement of
 * which action it runs — that is on the node already, under the name. Only a blank name is filled in, because a
 * nameless node is unreadable on the canvas.
 */
export function setStepAction(definition: FlowDefinition, stepId: string, target: StepTarget): FlowDefinition {
  const step = definition.steps.find((candidate) => candidate.id === stepId);

  if (!step || (step.kitId === target.kitId && step.actionName === target.actionName)) {
    return definition;
  }

  return mapStep(definition, stepId, (current) => ({
    ...current,
    kitId: target.kitId,
    actionName: target.actionName,
    input: target.input,
    // A connection belongs to the kit that needed it, so switching kit discards it.
    connectionId: undefined,
    name: keepOrName(current.name, target.displayName),
  }));
}

function keepOrName(currentName: string, fallback: string): string {
  return currentName.trim().length === 0 ? fallback : currentName;
}

export function setTriggerAction(definition: FlowDefinition, target: TriggerTarget): FlowDefinition {
  const { trigger } = definition;

  if (trigger.kitId === target.kitId && trigger.triggerName === target.triggerName) {
    return definition;
  }

  return {
    ...definition,
    trigger: {
      ...trigger,
      kitId: target.kitId,
      triggerName: target.triggerName,
      input: target.input,
      connectionId: undefined,
      name: keepOrName(trigger.name, target.displayName),
    },
  };
}

/**
 * Sets one field on a step.
 *
 * A field cleared to empty text removes the key rather than storing `""`. That keeps "never filled in" and
 * "deliberately blank" the same state, which is what the engine's resolved schema already assumes when it
 * treats blank as absent — storing the empty string instead would make a required field pass its stored schema
 * and fail at run time for a reason the builder never showed.
 */
export function setStepInput(definition: FlowDefinition, stepId: string, name: string, value: unknown): FlowDefinition {
  return mapStep(definition, stepId, (step) => ({ ...step, input: withInputValue(step.input, name, value) }));
}

export function setTriggerInput(definition: FlowDefinition, name: string, value: unknown): FlowDefinition {
  return {
    ...definition,
    trigger: { ...definition.trigger, input: withInputValue(definition.trigger.input, name, value) },
  };
}

function withInputValue(input: Record<string, unknown>, name: string, value: unknown): Record<string, unknown> {
  if (value === "" || value === undefined) {
    const { [name]: _cleared, ...rest } = input;

    return rest;
  }

  return { ...input, [name]: value };
}

export function setStepConnection(
  definition: FlowDefinition,
  stepId: string,
  connectionId: string | undefined,
): FlowDefinition {
  return mapStep(definition, stepId, (step) => ({ ...step, connectionId }));
}

export function setTriggerConnection(definition: FlowDefinition, connectionId: string | undefined): FlowDefinition {
  return { ...definition, trigger: { ...definition.trigger, connectionId } };
}

export function setStepContinueOnFailure(
  definition: FlowDefinition,
  stepId: string,
  continueOnFailure: boolean,
): FlowDefinition {
  return mapStep(definition, stepId, (step) => ({ ...step, continueOnFailure }));
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
