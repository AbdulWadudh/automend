/**
 * Turning a step's stored configuration into the values a kit receives.
 *
 * Two stages, and the order matters:
 *
 * 1. **Substitute.** `{{trigger.body.orderId}}` becomes the value the flow received. Substitution, emphatically
 *    not evaluation — `renderTemplate` in `@automend/shared` resolves a plain property path and can do nothing
 *    else, which is the platform's first rule applied to the place it would most easily erode.
 * 2. **Coerce and check.** The resolved text goes through the action's own `buildResolvedInputSchema`, which
 *    turns `"1000"` into `1000`, applies defaults, and refuses a required field that is still empty.
 *
 * This runs in the *parent*, not the subprocess, for two reasons. It is pure — no network, no filesystem, no
 * credential — so it is unit-testable without spawning anything, and it is the last point at which a step can be
 * refused before a side effect happens. A step whose input does not resolve never reaches the child at all.
 */

import { buildResolvedInputSchema, describeInputIssues, type InputPropertyMap } from "@automend/kit-framework";
import { type FlowStepInput, listTemplateVariables, renderTemplate } from "@automend/shared";

/**
 * What a `{{...}}` may refer to.
 *
 * Deliberately a fixed, two-branch shape rather than a bag of whatever is lying around:
 *
 * - `trigger` — what the trigger produced. For a webhook that is the whole delivery, so a template can reach the
 *   headers and the method as well as the body.
 * - `steps` — earlier steps' outputs, keyed by a slug derived from the name the author gave them.
 *
 * A step id would be correct and unwritable; the raw name is writable and *unsafe*. A name is free text: "Look up
 * the order" contains spaces, which `renderTemplate`'s path grammar does not admit, and "Total (2.5)" contains a
 * dot, which would split the path in the wrong place and resolve to nothing with no indication why. The slug is
 * closed over the safe alphabet by construction, so neither can happen.
 *
 * Renaming a step still breaks templates pointing at it. That is visible — the variable renders as the literal it
 * was written as and the run reports it unresolved — where keying by id would be invisible and untypeable.
 */
export type ResolutionContext = {
  trigger: unknown;
  steps: Record<string, unknown>;
};

export function buildResolutionContext(triggerPayload: unknown): ResolutionContext {
  return { trigger: triggerPayload, steps: {} };
}

/**
 * The handle a template uses for a step: its name in camelCase, stripped of anything a path cannot carry.
 *
 * `"Look up the order"` becomes `lookUpTheOrder`, so `{{steps.lookUpTheOrder.total}}` is a valid path. A name made
 * entirely of punctuation has nothing to derive from and falls back to `step`, which the collision handling below
 * then makes unique — an unreachable output would be worse than an ugly key.
 */
export function stepVariableKey(stepName: string): string {
  const words = stepName.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return "step";
  }

  const [first, ...rest] = words;

  return [
    (first ?? "").charAt(0).toLowerCase() + (first ?? "").slice(1),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
  ].join("");
}

/**
 * Every step's handle, made unique.
 *
 * Two steps called "Send email" and "Send Email" slug identically, and one silently shadowing the other would
 * make a template resolve against the wrong step's output — the kind of bug that looks like the flow working. The
 * later one is suffixed instead, in definition order, so the same flow always produces the same keys.
 */
export function buildStepVariableKeys(steps: readonly { id: string; name: string }[]): Map<string, string> {
  const keys = new Map<string, string>();
  const used = new Set<string>();

  for (const step of steps) {
    const base = stepVariableKey(step.name);
    let key = base;

    for (let suffix = 2; used.has(key); suffix += 1) {
      key = `${base}${suffix}`;
    }

    used.add(key);
    keys.set(step.id, key);
  }

  return keys;
}

/** Records a step's output under its handle, for the steps that come after it. */
export function withStepOutput(context: ResolutionContext, stepKey: string, output: unknown): ResolutionContext {
  return { ...context, steps: { ...context.steps, [stepKey]: output } };
}

export type ResolvedInput = {
  /** Ready for the kit: templates substituted, values coerced to their declared types. */
  input: Record<string, unknown>;
};

export type ResolutionFailure = {
  /** Why the step cannot run, phrased for the person who configured it. */
  message: string;
  unresolved: string[];
};

/**
 * Substitutes into every templatable field, then validates the whole record.
 *
 * Only *templatable* fields are substituted. A checkbox or a dropdown holds its declared type at rest and has no
 * text for a variable to live in, so running substitution over it would be a no-op at best and a stringified
 * boolean at worst.
 */
export function resolveStepInput(
  props: InputPropertyMap,
  stored: FlowStepInput,
  context: ResolutionContext,
): { ok: true; resolved: ResolvedInput } | { ok: false; failure: ResolutionFailure } {
  const substituted: Record<string, unknown> = {};
  const unresolved = new Set<string>();

  for (const [name, value] of Object.entries(stored)) {
    const property = props[name];

    if (!property?.templatable || typeof value !== "string") {
      substituted[name] = value;
      continue;
    }

    const rendered = renderTemplate(value, context);

    for (const path of rendered.unresolved) {
      unresolved.add(path);
    }

    substituted[name] = rendered.text;
  }

  /**
   * A variable the data did not contain stops the step, here, before anything leaves the process.
   *
   * This used to be reported and carried on with, on the reasoning that the literal `{{name}}` is visible in
   * the journal and that "a step that genuinely needed it fails its own required check a moment later". The
   * second half is not true, and that is the whole bug: `"{{email}}"` is a *non-empty string*, so a required
   * check passes and the literal is handed to the kit. Gmail then answered `HTTP 400 — Invalid To header`,
   * which says nothing about the variable and names no field.
   *
   * There is no reading under which `{{name}}` is a value somebody meant to transmit, so refusing is both
   * safe and far more informative. A step that should tolerate it can set `continueOnFailure`.
   */
  if (unresolved.size > 0) {
    const paths = [...unresolved];

    return {
      ok: false,
      failure: {
        message: `${paths.length === 1 ? "the variable" : "the variables"} ${paths
          .map((path) => `{{${path}}}`)
          .join(", ")} did not resolve — the flow's data has no such value`,
        unresolved: paths,
      },
    };
  }

  const parsed = buildResolvedInputSchema(props).safeParse(substituted);

  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        message: describeInputIssues(parsed.error).join("; "),
        unresolved: [],
      },
    };
  }

  return { ok: true, resolved: { input: parsed.data } };
}

/**
 * Every variable a step's configuration refers to, whether or not it resolves.
 *
 * Used for the journal: recording which variables a step *wanted* makes a run whose data arrived in a different
 * shape than expected diagnosable, rather than leaving an author to guess why a field came out empty.
 */
export function listStepVariables(props: InputPropertyMap, stored: FlowStepInput): string[] {
  const found = new Set<string>();

  for (const [name, value] of Object.entries(stored)) {
    if (props[name]?.templatable && typeof value === "string") {
      for (const path of listTemplateVariables(value)) {
        found.add(path);
      }
    }
  }

  return [...found];
}
