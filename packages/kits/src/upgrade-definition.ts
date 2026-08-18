/**
 * Migrating a stored v1 definition to v2.
 *
 * v1 was a closed union: a step named one of four hardcoded kinds and carried fields specific to each. v2
 * names a kit and an action and carries an opaque `input`, so what a step can do is the registry rather than a
 * union in `flow-definition.ts`. That is the change the whole kit model rests on, and `definitionVersion`
 * exists precisely so it can be made without abandoning stored rows.
 *
 * This lives in `@automend/kits` rather than in `@automend/shared` for one reason: the mapping *names kits*,
 * and shared cannot know about them. It runs on read, in `packages/db/src/flows.ts`, so "a flow read from the
 * database has a current definition" holds in one place rather than at every call site.
 *
 * The *mapping* is pure data: a v1 kind becomes a fixed kit-and-action pair whether that kit is still
 * installed or not, because silently dropping a step whose kit had gone would lose an author's work without
 * telling them. `validateDefinitionAgainstRegistry` is what reports it afterwards.
 *
 * The *values* do consult the registry, and have to. v1 stored a duration as the number `1000`; v2 stores every
 * templatable field as text, because a field that may hold `{{retryAfterMs}}` cannot be a number at rest. Only
 * the property declarations know which fields those are, so the alternative is four hardcoded field lists that
 * would go stale. When a kit is missing the values are carried across untouched — an unreadable step is still
 * better than a lost one.
 */

import type { InputPropertyMap } from "@automend/kit-framework";
import { config, type FlowDefinition, flowDefinitionSchema } from "@automend/shared";
import { z } from "zod";
import { findAction, findTrigger } from "./registry";

/**
 * Where each v1 kind went.
 *
 * The old names were kebab-case and the new ones are camelCase, so this is a genuine rename rather than a
 * passthrough — `tests/upgrade-definition.test.ts` asserts every row of it.
 */
const STEP_MAPPING = {
  "http-request": { kitId: "http", actionName: "request" },
  "send-email": { kitId: "gmail", actionName: "sendEmail" },
  delay: { kitId: "core", actionName: "delay" },
  log: { kitId: "core", actionName: "log" },
} as const;

const TRIGGER_MAPPING = {
  manual: { kitId: "core", triggerName: "manual" },
  webhook: { kitId: "core", triggerName: "webhook" },
  schedule: { kitId: "core", triggerName: "schedule" },
} as const;

/**
 * The v1 shape, described loosely on purpose.
 *
 * This is archaeology, not validation: the rows already exist and the goal is to read as many as possible. So
 * unknown keys pass through, the graph is not re-checked (the v2 schema does that at the end), and each
 * node's payload is a bag that the mapping below picks fields out of.
 */
const legacyNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.looseObject({ kind: z.string() }),
});

const legacyDefinitionSchema = z.object({
  version: z.literal(1),
  trigger: legacyNodeSchema,
  steps: z.array(legacyNodeSchema),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
});

type LegacyNode = z.infer<typeof legacyNodeSchema>;

/**
 * Everything except `kind`, which becomes the kit and action rather than a value.
 *
 * Carried across wholesale rather than field by field, because every v1 field found a home under the same name
 * in the v2 action that replaced it: `method` and `url` on `http.request`, `to`/`subject`/`body` on
 * `gmail.sendEmail`, `durationMs` on `core.delay`, `message` on `core.log`. Anything the new action does not
 * declare is stripped by its stored schema on the next save, which is the behaviour we want — the alternative
 * is enumerating four field lists that would go stale.
 */
function carryInput(node: LegacyNode): Record<string, unknown> {
  const { kind, ...rest } = node.config;

  void kind;

  return rest;
}

/**
 * Retypes v1 values for the way v2 stores them.
 *
 * v1 stored a duration as the number `1000`. v2 stores every templatable field as *text*, because a field that
 * may hold `{{retryAfterMs}}` cannot be a number at rest — so the same value has to become `"1000"` or the
 * upgraded flow fails its own stored schema. This is the only shape change between the versions, and it is
 * driven off the property declarations rather than a list of field names, which would go stale.
 *
 * A non-templatable property keeps its type: a checkbox is a boolean at rest and stringifying it would break
 * it in the opposite direction.
 */
function retypeForStoredSchema(props: InputPropertyMap | undefined, input: Record<string, unknown>) {
  if (!props) {
    return input;
  }

  const retyped: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(input)) {
    const templatable = props[name]?.templatable === true;
    const isScalar = typeof value === "number" || typeof value === "boolean";

    retyped[name] = templatable && isScalar ? String(value) : value;
  }

  return retyped;
}

/**
 * v1 kept a `connectionId` inside the step's config; v2 promotes it to the step itself, since every kit may
 * need one and it is no longer one kind's private field.
 */
function carryConnectionId(node: LegacyNode): string | undefined {
  const value = node.config.connectionId;

  return typeof value === "string" ? value : undefined;
}

function upgradeTrigger(trigger: LegacyNode) {
  const mapped = TRIGGER_MAPPING[trigger.config.kind as keyof typeof TRIGGER_MAPPING];

  if (!mapped) {
    throw new Error(`Cannot upgrade a flow with an unknown v1 trigger kind "${trigger.config.kind}"`);
  }

  const { connectionId: _ignored, ...input } = carryInput(trigger);
  const props = findTrigger(mapped.kitId, mapped.triggerName)?.props;

  return {
    id: trigger.id,
    name: trigger.name,
    position: trigger.position,
    kitId: mapped.kitId,
    triggerName: mapped.triggerName,
    input: retypeForStoredSchema(props, input),
    connectionId: carryConnectionId(trigger),
  };
}

function upgradeStep(step: LegacyNode) {
  const mapped = STEP_MAPPING[step.config.kind as keyof typeof STEP_MAPPING];

  if (!mapped) {
    throw new Error(`Cannot upgrade a flow with an unknown v1 step kind "${step.config.kind}"`);
  }

  const { connectionId: _ignored, ...input } = carryInput(step);
  const props = findAction(mapped.kitId, mapped.actionName)?.props;

  return {
    id: step.id,
    name: step.name,
    position: step.position,
    kitId: mapped.kitId,
    actionName: mapped.actionName,
    input: retypeForStoredSchema(props, input),
    connectionId: carryConnectionId(step),
    // v1 had no such switch, and the safe reading of a flow written before the choice existed is that it
    // stops when a step fails.
    continueOnFailure: false,
  };
}

/**
 * A stored definition, whatever version it was written at, as a current one.
 *
 * Throws rather than returning a partial result. A definition that cannot be read is not something to paper
 * over: executing half of somebody's flow is worse than refusing to execute it, and the API surfaces the
 * failure as a validation error naming the flow.
 */
export function upgradeFlowDefinition(stored: unknown): FlowDefinition {
  const current = flowDefinitionSchema.safeParse(stored);

  if (current.success) {
    return current.data;
  }

  const legacy = legacyDefinitionSchema.safeParse(stored);

  if (!legacy.success) {
    // The v2 error, not the v1 one: a definition that is neither is almost certainly a v2 with a real problem,
    // and reporting "version must be 1" would send a reader somewhere useless.
    throw new Error(`This flow's definition cannot be read: ${current.error.issues[0]?.message ?? "unknown shape"}`);
  }

  const upgraded = {
    version: config.flows.definitionVersion,
    trigger: upgradeTrigger(legacy.data.trigger),
    steps: legacy.data.steps.map(upgradeStep),
    edges: legacy.data.edges,
  };

  // Parsed rather than returned as built, so the upgrade cannot produce something the rest of the platform
  // would reject — including the graph rules, which v1 enforced under the same names.
  return flowDefinitionSchema.parse(upgraded);
}

/** Whether a stored definition needs upgrading, for a caller that wants to avoid rewriting a row needlessly. */
export function isCurrentDefinition(stored: unknown): boolean {
  return flowDefinitionSchema.safeParse(stored).success;
}
