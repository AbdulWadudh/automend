/**
 * The second half of validating a flow: does it name things that exist, and do their inputs suit them.
 *
 * `flowDefinitionSchema` in `@automend/shared` has already checked the *structure* — node ids, the graph, the
 * shape of each step. It cannot check anything more, because it is imported by the browser and
 * `@automend/shared` promises to depend on nothing, so it has no way to reach the registry. That is the whole
 * reason validation is in two layers rather than one.
 *
 * Called by the API when a flow is saved, and by the engine before a run starts — the second time is not
 * redundant. A run executes a *snapshot* taken when it began, and a kit may have been changed or removed
 * between the save and the retry, so a definition that was valid on save can be invalid by the time it runs.
 */

import { buildStoredInputSchema, describeInputIssues } from "@automend/kit-framework";
import type { FlowDefinition, FlowStepInput } from "@automend/shared";
import { findAction, findKit, findTrigger } from "./registry";

export type DefinitionIssue = {
  /** Dotted path into the definition, so a message can be shown against the field it belongs to. */
  path: string;
  message: string;
};

/**
 * Checks a step's or trigger's saved values against the property map they were declared with.
 *
 * The *stored* schema, not the resolved one: a half-configured step is a normal thing to save, and a field
 * holding `{{orderId}}` is text until the flow has data. Requiring completeness here would stop an author
 * saving work in progress, which is the one thing the builder must always be able to do.
 */
function checkInput(props: Parameters<typeof buildStoredInputSchema>[0], input: FlowStepInput, path: string) {
  const result = buildStoredInputSchema(props).safeParse(input);

  if (result.success) {
    return [];
  }

  return describeInputIssues(result.error).map((message) => ({ path: `${path}.input`, message }));
}

/**
 * Every reason this definition could not be executed, or an empty list.
 *
 * Returns issues rather than throwing so a caller can report all of them at once. An author who renamed a kit
 * should see every step that needs attention, not the first one.
 */
export function validateDefinitionAgainstRegistry(definition: FlowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const { trigger } = definition;

  const triggerDefinition = findTrigger(trigger.kitId, trigger.triggerName);

  if (!triggerDefinition) {
    // Distinguishing the two is worth a sentence: a missing kit and a missing trigger within a present kit
    // need different fixes, and "unknown trigger" on a kit that was deleted reads as a typo.
    const message = findKit(trigger.kitId)
      ? `"${trigger.kitId}" has no trigger called "${trigger.triggerName}"`
      : `There is no kit called "${trigger.kitId}"`;

    issues.push({ path: "trigger", message });
  } else {
    issues.push(...checkInput(triggerDefinition.props, trigger.input, "trigger"));
  }

  definition.steps.forEach((step, index) => {
    const path = `steps.${index}`;
    const action = findAction(step.kitId, step.actionName);

    if (!action) {
      const message = findKit(step.kitId)
        ? `"${step.kitId}" has no action called "${step.actionName}"`
        : `There is no kit called "${step.kitId}"`;

      issues.push({ path, message });

      return;
    }

    issues.push(...checkInput(action.props, step.input, path));
  });

  return issues;
}

/**
 * Whether every step in a definition names a connection where its kit needs one.
 *
 * Kept apart from `validateDefinitionAgainstRegistry` on purpose, because the answer is allowed to be no. A
 * flow saved before its Google account is connected is a normal state to be in — the builder shows it as
 * unfinished — whereas a *run* that reached such a step has to fail. So the API calls the function above and
 * the engine calls both.
 */
export function findStepsMissingConnections(definition: FlowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];

  const requiresConnection = (kitId: string) => findKit(kitId)?.auth !== undefined;

  if (requiresConnection(definition.trigger.kitId) && definition.trigger.connectionId === undefined) {
    issues.push({
      path: "trigger",
      message: `"${definition.trigger.name}" needs a connection before this flow can run`,
    });
  }

  definition.steps.forEach((step, index) => {
    if (requiresConnection(step.kitId) && step.connectionId === undefined) {
      issues.push({
        path: `steps.${index}`,
        message: `"${step.name}" needs a connection before it can run`,
      });
    }
  });

  return issues;
}

/** `trigger: message` lines, for an error a person has to act on. */
export function describeDefinitionIssues(issues: readonly DefinitionIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
