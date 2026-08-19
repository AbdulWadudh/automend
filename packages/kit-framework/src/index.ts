/**
 * `@automend/kit-framework` — the SDK a kit is written against.
 *
 * Browser-safe in full: everything here is types, plain-data descriptors and pure functions. The
 * guarded HTTP client, the store and the engine that calls `invoke` live in the worker; this package
 * only describes the shapes they satisfy, which is what lets the builder import it for rendering.
 */

export type { ActionDefinition, ActionRunner, CreateActionSpec } from "./action";
export { createAction } from "./action";
export type {
  CatalogueOptions,
  KitActionSummary,
  KitCatalogue,
  KitCatalogueEntry,
  KitProperty,
  KitTriggerSummary,
} from "./catalogue";
export {
  kitActionSchema,
  kitCatalogueEntrySchema,
  kitCatalogueSchema,
  kitPropertySchema,
  kitTriggerSchema,
  toKitCatalogue,
} from "./catalogue";
export type { ActionContext, KitCredential, KitInvocation, RunContext, StepContext } from "./context";
export { requireOAuthToken, requireToken } from "./context";
export type { DedupeStrategy, LastItemPoll, Poll, TimestampPoll } from "./dedupe";
export { initialiseDedupe, pollWithDedupe, testPoll } from "./dedupe";
export { deepFreeze } from "./freeze";
export type { HttpClient, HttpMethod, HttpRequest, HttpResponse, KitLogger } from "./http";
export type { InputSchema } from "./input-schema";
export { buildResolvedInputSchema, buildStoredInputSchema, describeInputIssues } from "./input-schema";
export type { CreateKitSpec, KitAuthRequirement, KitDefinition, KitRateLimit } from "./kit";
export { createKit, KIT_NAME_PATTERN, kitOAuth, kitRateLimit, kitToken } from "./kit";
export type {
  CheckboxProperty,
  DropdownOption,
  DynamicDropdownProperty,
  InputProperty,
  InputPropertyMap,
  JsonProperty,
  LoadOptions,
  LoadOptionsContext,
  LongTextProperty,
  NumberProperty,
  PropertyType,
  PropertyValue,
  ResolvedInput,
  ShortTextProperty,
  StaticDropdownProperty,
} from "./property";
export { Property } from "./property";
export type { KitStore } from "./store";
export type { CreateTriggerSpec, TriggerDefinition, TriggerInvocation, TriggerStrategy } from "./trigger";
export { createTrigger, isSchedulable } from "./trigger";
