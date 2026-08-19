/**
 * Request shapes for the kit catalogue's own endpoints.
 *
 * The catalogue *response* is described in `kit-framework`, because it is derived from the property
 * declarations that live there. What a caller sends belongs here instead: `shared` depends on nothing
 * and the browser imports it, so the builder validates the request it is about to make against the
 * same schema the api validates on arrival.
 */

import { z } from "zod";
import { config } from "./config";

/**
 * Ask a kit what a dynamic dropdown's choices are.
 *
 * `input` is the step as configured so far, for a dropdown that narrows another. It is passed through
 * to the loader untouched and is not the stored definition, so it is bounded by key count rather than
 * validated against the action's property map — the api has no reason to re-derive that here, and the
 * loader is the thing that decides which keys it cares about.
 */
export const loadPropertyOptionsRequestSchema = z.object({
  kitId: z.string().min(1),
  target: z.enum(["action", "trigger"]),
  targetName: z.string().min(1),
  propertyName: z.string().min(1),
  /** Which workspace connection to act as. A dynamic dropdown without one has nothing to ask. */
  connectionId: z.uuid(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export type LoadPropertyOptionsRequest = z.infer<typeof loadPropertyOptionsRequestSchema>;

export const propertyOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** A qualifier shown beside the label, so an option is never told apart by an icon alone. */
  description: z.string().optional(),
});

export const propertyOptionsResponseSchema = z.object({
  options: z.array(propertyOptionSchema).max(config.kits.maxDynamicOptions),
  /**
   * True when the service had more than the platform will carry. The builder says so rather than
   * letting an author scroll a list that silently stops.
   */
  truncated: z.boolean(),
});

export type PropertyOption = z.infer<typeof propertyOptionSchema>;
export type PropertyOptionsResponse = z.infer<typeof propertyOptionsResponseSchema>;
