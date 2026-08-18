/**
 * `@automend/kits` — the catalogue of services Automend can act through.
 *
 * Imported by the API, which serves the catalogue to the builder and validates a saved flow against it,
 * and by the worker, which executes through it. Never by the browser: a kit's code calls third-party
 * APIs and has no business in a bundle, which is why the builder reads the catalogue over HTTP instead.
 */

export { coreKit } from "./core";
export { gmailKit } from "./gmail";
export { httpKit } from "./http";
export { describeStepKind, findAction, findKit, findTrigger, kits } from "./registry";
export { isCurrentDefinition, upgradeFlowDefinition } from "./upgrade-definition";
export type { DefinitionIssue } from "./validate-definition";
export {
  describeDefinitionIssues,
  findStepsMissingConnections,
  validateDefinitionAgainstRegistry,
} from "./validate-definition";
