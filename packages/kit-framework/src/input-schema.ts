/**
 * Two Zod schemas per property map, because a property has two lives.
 *
 * At rest, a field that supports `{{variable}}` holds text: a number input configured with
 * `{{orderCount}}` is the string `"{{orderCount}}"` in the database, and it cannot be anything else
 * until the flow has data to substitute. At run time, after `renderTemplate` has replaced the
 * variables, that same field has to become an actual number before the kit sees it.
 *
 * So:
 *
 * - `buildStoredInputSchema` is what the builder saves through and what a stored definition is
 *   validated against. It checks *types*, not completeness — a half-configured step is a normal
 *   thing to save, so every field is optional here.
 * - `buildResolvedInputSchema` is what the engine validates against once templates are resolved. It
 *   coerces to the declared type, applies defaults and enforces `required`.
 *
 * Splitting them is what lets the builder save work in progress without the engine ever running a
 * step whose input is missing or the wrong shape.
 */

import { z } from "zod";
import type { InputProperty, InputPropertyMap } from "./property";

export type InputSchema = z.ZodType<Record<string, unknown>>;

/**
 * The choices of a static dropdown, as a Zod enum.
 *
 * `z.enum` needs a non-empty tuple to infer from; the length check above the cast is what makes it
 * sound. A dropdown declared with no options can accept nothing, and says so rather than accepting
 * everything.
 */
function dropdownSchema(options: readonly { readonly value: string }[]): z.ZodType {
  const values = options.map((option) => option.value);
  const [first, ...rest] = values;

  if (first === undefined) {
    return z.never();
  }

  return z.enum([first, ...rest]);
}

/** JSON arrives as text, because a JSON field is a text box that supports variables. */
const jsonTextSchema = z
  .string()
  .refine(
    (value) => {
      try {
        JSON.parse(value);

        return true;
      } catch {
        return false;
      }
    },
    { message: "Must be valid JSON" },
  )
  // Safe to parse here rather than in a try: the refinement above has already run.
  .transform((value): unknown => JSON.parse(value));

function storedPropertySchema(property: InputProperty): z.ZodType {
  // A templatable field is text at rest whatever it will become, so its stored type is the same for
  // every declared type and there is nothing further to check.
  if (property.templatable) {
    return z.string();
  }

  switch (property.type) {
    case "checkbox":
      return z.boolean();
    case "staticDropdown":
      return dropdownSchema(property.options);
    default:
      return z.unknown();
  }
}

function resolvedPropertySchema(property: InputProperty): z.ZodType {
  switch (property.type) {
    case "shortText":
    case "longText":
      return z.string();
    // Coerced rather than checked: the value reaching here is the text a template resolved to, so
    // `"42"` is the normal case and `42` only occurs when a default supplied it.
    case "number":
      return z.coerce.number().finite();
    case "checkbox":
      return z.boolean();
    case "staticDropdown":
      return dropdownSchema(property.options);
    case "json":
      return jsonTextSchema;
  }
}

/**
 * Whether a value counts as absent.
 *
 * An empty text field is not the empty string, it is a field nobody filled in — so a required one
 * must fail rather than pass with `""`, and an optional number must stay undefined rather than
 * become `0`, which is what coercing `""` would otherwise produce.
 */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Wraps a property's schema in its presence rules.
 *
 * The blank-to-default mapping happens in a `preprocess` rather than through `.optional()` and
 * `.default()` alone, because Zod's `.default()` only fires on `undefined` — a field cleared in the
 * builder arrives as `""` and would otherwise skip its default and fail.
 */
function withPresence(base: z.ZodType, property: InputProperty): z.ZodType {
  const normalise = (value: unknown) => (isBlank(value) ? property.defaultValue : value);

  return z.preprocess(normalise, property.required ? base : base.optional());
}

/**
 * Unknown keys are stripped, not rejected.
 *
 * A kit that drops a property would otherwise make every flow still holding it unopenable. Stripping
 * means the stale key is quietly cleaned up the next time the step is saved.
 */
export function buildStoredInputSchema(props: InputPropertyMap): InputSchema {
  const shape: Record<string, z.ZodType> = {};

  for (const [name, property] of Object.entries(props)) {
    shape[name] = storedPropertySchema(property).optional();
  }

  return z.object(shape);
}

export function buildResolvedInputSchema(props: InputPropertyMap): InputSchema {
  const shape: Record<string, z.ZodType> = {};

  for (const [name, property] of Object.entries(props)) {
    shape[name] = withPresence(resolvedPropertySchema(property), property);
  }

  return z.object(shape);
}

/** `path: message` lines, for an error a person has to act on. */
export function describeInputIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
