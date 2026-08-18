import { describeDefinitionIssues, validateDefinitionAgainstRegistry } from "@automend/kits";
import { type FlowDefinition, flowValidationError } from "@automend/shared";

/**
 * The half of validation the shared schema cannot do: whether the kits and actions a definition names
 * exist and whether its saved values suit their fields. Every issue is reported at once, so an author
 * who renamed a kit sees every affected step rather than one save at a time.
 */
export function assertDefinitionIsExecutable(definition: FlowDefinition): void {
  const issues = validateDefinitionAgainstRegistry(definition);

  if (issues.length > 0) {
    throw flowValidationError(describeDefinitionIssues(issues));
  }
}
