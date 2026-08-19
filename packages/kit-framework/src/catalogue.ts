/**
 * The kit catalogue, as the browser receives it.
 *
 * The builder has to render a step picker and a settings form for every kit, which means it needs kit
 * *metadata* — but emphatically not kit *code*, which calls third-party APIs and has no business in a
 * bundle. So the API derives this description from the registry and serves it, and the web app parses
 * it with the schema below. That is the whole reason this module exists.
 */

import { config } from "@automend/shared";
import { z } from "zod";
import type { KitDefinition } from "./kit";
import type { InputPropertyMap } from "./property";
import { isSchedulable } from "./trigger";

/**
 * An array rather than an object keyed by name, because the order a kit declares its properties in is
 * the order the form should show them — recipient before subject before body.
 */
export const kitPropertySchema = z.object({
  name: z.string(),
  type: z.enum(config.kits.propertyTypes),
  displayName: z.string(),
  description: z.string().optional(),
  required: z.boolean(),
  /** Whether the field accepts `{{variable}}`, which decides whether it renders a template editor. */
  templatable: z.boolean(),
  defaultValue: z.unknown().optional(),
  /**
   * The bounds the kit declared, carried across so the builder can enforce them *in the field* rather than
   * letting somebody type 60,000 characters and discover on save that it was refused.
   *
   * `maxLength` bounds what an author may type; `minimum`/`maximum` bound what the value may be once a variable
   * has resolved — which is why a number field shows the range as a hint rather than clamping to it.
   */
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** Present only for `staticDropdown`. A dynamic one's choices are fetched, not described here. */
  options: z.array(z.object({ label: z.string(), value: z.string(), description: z.string().optional() })).optional(),
  /**
   * Present only for `longText`: whether the field offers formatting and therefore stores HTML.
   *
   * Carried across because the difference is not presentational — a rich field's value is markup, and
   * a kit sending it somewhere that expects plain text gets markup.
   */
  rich: z.boolean().optional(),
  /**
   * Present only for `dynamicDropdown`: the properties its loader reads.
   *
   * The builder refetches when one of them changes, and offers nothing until each has a value — a
   * loader asked for "the tabs in spreadsheet undefined" would answer with an error rather than a list.
   */
  dependsOn: z.array(z.string()).optional(),
});

export type KitProperty = z.infer<typeof kitPropertySchema>;

export const kitActionSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  properties: z.array(kitPropertySchema),
});

export type KitActionSummary = z.infer<typeof kitActionSchema>;

export const kitTriggerSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  strategy: z.enum(config.kits.triggerStrategies),
  /**
   * Whether this deployment can actually fire it. A trigger that is not schedulable is offered
   * disabled with a reason rather than hidden — an author choosing it would otherwise build a flow
   * that silently never runs.
   */
  schedulable: z.boolean(),
  /** Populates the variable picker before the flow has run even once. */
  sampleData: z.unknown(),
  properties: z.array(kitPropertySchema),
});

export type KitTriggerSummary = z.infer<typeof kitTriggerSchema>;

export const kitCatalogueEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  /** The connector a connection must come from, or null for a kit that needs no credentials. */
  auth: z
    .object({
      kind: z.enum(["oauth", "token"]),
      connectorId: z.string(),
      scopes: z.array(z.string()),
    })
    .nullable(),
  /**
   * False when this deployment has not configured the connector this kit needs. Listed as unavailable
   * rather than omitted, so an operator can see what they could turn on.
   */
  available: z.boolean(),
  actions: z.array(kitActionSchema),
  triggers: z.array(kitTriggerSchema),
});

export type KitCatalogueEntry = z.infer<typeof kitCatalogueEntrySchema>;

export const kitCatalogueSchema = z.array(kitCatalogueEntrySchema);

export type KitCatalogue = z.infer<typeof kitCatalogueSchema>;

function describeProperties(props: InputPropertyMap): KitProperty[] {
  return Object.entries(props).map(([name, property]) => ({
    name,
    type: property.type,
    displayName: property.displayName,
    description: property.description,
    required: property.required,
    templatable: property.templatable,
    defaultValue: property.defaultValue,
    maxLength: property.maxLength,
    minimum: property.type === "number" ? property.minimum : undefined,
    maximum: property.type === "number" ? property.maximum : undefined,
    options: property.type === "staticDropdown" ? property.options.map((option) => ({ ...option })) : undefined,
    rich: property.type === "longText" ? property.rich : undefined,
    dependsOn: property.type === "dynamicDropdown" ? [...property.dependsOn] : undefined,
  }));
}

export type CatalogueOptions = {
  /** From the API's own dependencies — which connectors this deployment holds credentials for. */
  availableConnectorIds: readonly string[];
};

export function toKitCatalogue(kits: readonly KitDefinition[], options: CatalogueOptions): KitCatalogue {
  return kits.map((kit) => ({
    id: kit.id,
    displayName: kit.displayName,
    description: kit.description,
    auth: kit.auth
      ? {
          kind: kit.auth.kind,
          connectorId: kit.auth.connectorId,
          scopes: kit.auth.kind === "oauth" ? [...kit.auth.scopes] : [],
        }
      : null,
    // A kit needing no credentials is always available; one that does depends on the deployment.
    available: kit.auth === undefined || options.availableConnectorIds.includes(kit.auth.connectorId),
    actions: kit.actions.map((action) => ({
      name: action.name,
      displayName: action.displayName,
      description: action.description,
      properties: describeProperties(action.props),
    })),
    triggers: kit.triggers.map((trigger) => ({
      name: trigger.name,
      displayName: trigger.displayName,
      description: trigger.description,
      strategy: trigger.strategy,
      schedulable: isSchedulable(trigger.strategy),
      sampleData: trigger.sampleData,
      properties: describeProperties(trigger.props),
    })),
  }));
}
