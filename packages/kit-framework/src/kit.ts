/**
 * `createKit` — one service's worth of capability.
 *
 * A kit is the unit of "add a service": a directory, a `createKit` call and one line in the registry.
 * It owns its actions and triggers, and it names the *connector* its credentials come from — it never
 * holds a credential itself. `connectorId` is typed against the real catalogue in
 * `config.connectors.providers`, so a kit cannot point at a connector this platform does not have.
 *
 * The checks below run when the module is imported, which means a malformed kit fails at process
 * start rather than the first time somebody builds a flow with it.
 */

import { type ConnectorId, config } from "@automend/shared";
import type { ActionDefinition } from "./action";
import type { TriggerDefinition } from "./trigger";

export type KitAuthRequirement =
  | { readonly kind: "oauth"; readonly connectorId: ConnectorId; readonly scopes: readonly string[] }
  | { readonly kind: "token"; readonly connectorId: ConnectorId };

/**
 * The scopes are recorded for the catalogue to display, not to request.
 *
 * The connector's own entry is what the OAuth flow uses, because consent is granted once per
 * connection and shared by every kit that names that connector. A kit listing a scope its connector
 * does not request would be a promise the platform cannot keep, which is what
 * `tests/config.test.ts` checks.
 */
export function kitOAuth(spec: { connectorId: ConnectorId; scopes: readonly string[] }): KitAuthRequirement {
  return { kind: "oauth", connectorId: spec.connectorId, scopes: spec.scopes };
}

export function kitToken(spec: { connectorId: ConnectorId }): KitAuthRequirement {
  return { kind: "token", connectorId: spec.connectorId };
}

/**
 * What the service will accept from one account, which is the shape a published quota comes in.
 *
 * Declared rather than configured, because the number belongs to the service and a kit author is the one
 * reading its documentation. The engine keys the bucket by *connection*, so this is a per-account budget:
 * a workspace with two Google connections gets two of these, which is what Google itself grants.
 */
export type KitRateLimit = {
  readonly requests: number;
  readonly perSeconds: number;
};

export function kitRateLimit(spec: { requests: number; perSeconds: number }): KitRateLimit {
  return { requests: spec.requests, perSeconds: spec.perSeconds };
}

export type CreateKitSpec = {
  /** camelCase and globally unique — `gmail`, `googleSheets`. Stored in every flow that uses it. */
  id: string;
  displayName: string;
  description: string;
  /** Absent for a kit that needs no credentials, like `core` and `http`. */
  auth?: KitAuthRequirement;
  /** Absent means unthrottled, which is the honest default for a kit whose service publishes no quota. */
  limits?: KitRateLimit;
  actions?: readonly ActionDefinition[];
  triggers?: readonly TriggerDefinition[];
};

export type KitDefinition = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly auth: KitAuthRequirement | undefined;
  readonly limits: KitRateLimit | undefined;
  readonly actions: readonly ActionDefinition[];
  readonly triggers: readonly TriggerDefinition[];
};

/**
 * Kit ids and action and trigger names are camelCase.
 *
 * They are identifiers a kit author types and a stored flow refers to, so they read like the code
 * around them. Files stay kebab-case, matching the rest of the repo.
 *
 * Built from `config.kits.namePattern` rather than written out here, because `flow-definition.ts` applies
 * the same rule to a step read back out of the database — and a second copy of the pattern is how a
 * stored flow comes to name something no kit could be.
 */
export const KIT_NAME_PATTERN = new RegExp(config.kits.namePattern);

function assertName(label: string, name: string): void {
  if (!KIT_NAME_PATTERN.test(name)) {
    throw new Error(`${label} "${name}" must be camelCase — matching ${KIT_NAME_PATTERN.source}`);
  }
}

function assertUniqueNames(label: string, names: readonly string[]): void {
  const seen = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`${label} "${name}" is declared twice in the same kit`);
    }

    seen.add(name);
  }
}

/**
 * A dropdown with no choices can accept nothing, so a step configured with one could never be valid.
 * Caught here because the failure would otherwise surface as an unexplainable validation error.
 */
function assertDropdownsHaveOptions(owner: string, props: ActionDefinition["props"]): void {
  for (const [propertyName, property] of Object.entries(props)) {
    if (property.type === "staticDropdown" && property.options.length === 0) {
      throw new Error(`"${owner}.${propertyName}" is a dropdown with no options`);
    }
  }
}

/** A limit of zero requests would stop the kit dead, and a fractional one is a typo. */
function assertLimitsAreUsable(kitId: string, limits: KitRateLimit | undefined): void {
  if (!limits) {
    return;
  }

  const usable =
    Number.isInteger(limits.requests) &&
    limits.requests > 0 &&
    Number.isFinite(limits.perSeconds) &&
    limits.perSeconds > 0;

  if (!usable) {
    throw new Error(`Kit "${kitId}" declares an unusable rate limit — requests and perSeconds must both be above zero`);
  }
}

export function createKit(spec: CreateKitSpec): KitDefinition {
  const actions = spec.actions ?? [];
  const triggers = spec.triggers ?? [];

  assertName("Kit id", spec.id);
  assertLimitsAreUsable(spec.id, spec.limits);
  assertUniqueNames(
    "Action",
    actions.map((action) => action.name),
  );
  assertUniqueNames(
    "Trigger",
    triggers.map((trigger) => trigger.name),
  );

  for (const action of actions) {
    assertName("Action name", action.name);
    assertDropdownsHaveOptions(`${spec.id}.${action.name}`, action.props);
  }

  for (const trigger of triggers) {
    assertName("Trigger name", trigger.name);
    assertDropdownsHaveOptions(`${spec.id}.${trigger.name}`, trigger.props);
  }

  return {
    id: spec.id,
    displayName: spec.displayName,
    description: spec.description,
    auth: spec.auth,
    limits: spec.limits,
    actions,
    triggers,
  };
}
