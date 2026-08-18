/**
 * The kit catalogue, as the builder sees it.
 *
 * Fetched rather than imported. A kit's code calls third-party APIs and has no business in a browser bundle —
 * what the builder needs is the *description*: which actions exist, what fields each one has, what a trigger's
 * sample payload looks like. `@automend/kit-framework` is browser-safe and supplies the schema; the
 * implementations stay on the server.
 *
 * Cached indefinitely, because the catalogue only changes when the API is redeployed. Refetching it on every
 * panel open would be a request per click for data that cannot have moved.
 */

import {
  type KitCatalogue,
  type KitCatalogueEntry,
  type KitProperty,
  kitCatalogueSchema,
} from "@automend/kit-framework";
import { requestApi } from "./api";

const KITS_PATH = "/kits";

export const kitQueryKeys = {
  all: ["kits"] as const,
  catalogue: () => [...kitQueryKeys.all, "catalogue"] as const,
};

export async function fetchKitCatalogue(signal?: AbortSignal): Promise<KitCatalogue> {
  return await requestApi({ path: KITS_PATH, schema: kitCatalogueSchema, signal });
}

/** What a step or trigger points at, resolved out of the catalogue. */
export type KitTarget = {
  kit: KitCatalogueEntry;
  displayName: string;
  description: string;
  properties: KitProperty[];
};

export function findKitEntry(catalogue: KitCatalogue, kitId: string): KitCatalogueEntry | undefined {
  return catalogue.find((entry) => entry.id === kitId);
}

export function findActionTarget(catalogue: KitCatalogue, kitId: string, actionName: string): KitTarget | undefined {
  const kit = findKitEntry(catalogue, kitId);
  const action = kit?.actions.find((candidate) => candidate.name === actionName);

  return kit && action
    ? { kit, displayName: action.displayName, description: action.description, properties: action.properties }
    : undefined;
}

export function findTriggerTarget(catalogue: KitCatalogue, kitId: string, triggerName: string): KitTarget | undefined {
  const kit = findKitEntry(catalogue, kitId);
  const trigger = kit?.triggers.find((candidate) => candidate.name === triggerName);

  return kit && trigger
    ? { kit, displayName: trigger.displayName, description: trigger.description, properties: trigger.properties }
    : undefined;
}

export function findTriggerSummary(catalogue: KitCatalogue, kitId: string, triggerName: string) {
  return findKitEntry(catalogue, kitId)?.triggers.find((candidate) => candidate.name === triggerName);
}

/** Every action across every kit, flattened for a picker that lists them all together. */
export type ActionChoice = {
  kitId: string;
  kitName: string;
  actionName: string;
  displayName: string;
  description: string;
  properties: KitProperty[];
  /** False when this deployment has not configured the connector the kit needs. */
  available: boolean;
};

export function listActionChoices(catalogue: KitCatalogue): ActionChoice[] {
  return catalogue.flatMap((kit) =>
    kit.actions.map((action) => ({
      kitId: kit.id,
      kitName: kit.displayName,
      actionName: action.name,
      displayName: action.displayName,
      description: action.description,
      properties: action.properties,
      available: kit.available,
    })),
  );
}

export type TriggerChoice = {
  kitId: string;
  kitName: string;
  triggerName: string;
  displayName: string;
  description: string;
  properties: KitProperty[];
  available: boolean;
  /** False until the scheduler for this strategy exists — the builder refuses it *with a reason*. */
  schedulable: boolean;
  strategy: string;
};

export function listTriggerChoices(catalogue: KitCatalogue): TriggerChoice[] {
  return catalogue.flatMap((kit) =>
    kit.triggers.map((trigger) => ({
      kitId: kit.id,
      kitName: kit.displayName,
      triggerName: trigger.name,
      displayName: trigger.displayName,
      description: trigger.description,
      properties: trigger.properties,
      available: kit.available,
      schedulable: trigger.schedulable,
      strategy: trigger.strategy,
    })),
  );
}

/**
 * What a freshly added step or trigger holds.
 *
 * Only properties that declared a default appear, so an empty field stays genuinely empty rather than becoming
 * an empty string the stored schema then has to tolerate. The value is stringified for templatable fields
 * because those are text at rest — the same rule the engine reverses when it resolves them.
 */
export function buildDefaultInput(properties: readonly KitProperty[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  for (const property of properties) {
    if (property.defaultValue === undefined || property.defaultValue === null) {
      continue;
    }

    input[property.name] =
      property.templatable && typeof property.defaultValue !== "string"
        ? String(property.defaultValue)
        : property.defaultValue;
  }

  return input;
}
