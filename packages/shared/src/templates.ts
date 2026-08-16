/**
 * `{{variable}}` substitution for step fields.
 *
 * This is the mechanism by which data a flow *received* reaches the steps that act on it: a webhook
 * delivers `{ "name": "Ada" }`, and a step configured with `Hi {{name}}` sends `Hi Ada`.
 *
 * It substitutes. It does not evaluate. There is no expression syntax, no function call, no
 * arithmetic and no way to reach anything but a plain property of the data supplied — because the
 * platform's first rule is that user-authored code never runs in a server process, and a template
 * language is exactly where that rule erodes one convenience at a time. If a flow needs a computed
 * value, that is a step, executed in a sandbox, not an expression in a text box.
 */

import { config } from "./config";

const { templates } = config.flows;

/**
 * A path like `user.address.city` or `items.0.sku`.
 *
 * Deliberately narrow: letters, digits, underscore, hyphen and dots. No brackets, no quotes, no
 * spaces — anything richer would be the beginnings of a grammar.
 */
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_\-.]+)\s*\}\}/g;

/** Names that would reach the prototype chain rather than the data. Never resolvable. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type TemplateVariable = {
  /** The path as it is written inside the braces. */
  path: string;
  /** How it reads in a menu — the last segment, with its parents as context. */
  label: string;
  /** A shortened form of the value found at that path, to tell two similar fields apart. */
  preview: string;
};

export type RenderedTemplate = {
  text: string;
  /** Paths the data did not contain. Rendered as empty, and reported so the UI can say so. */
  unresolved: string[];
};

/** Every variable a template refers to, in the order they appear, without duplicates. */
export function listTemplateVariables(template: string): string[] {
  const found = new Set<string>();

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const path = match[1];

    if (path) {
      found.add(path);
    }
  }

  return [...found];
}

/**
 * Walks a path through plain data.
 *
 * Returns `undefined` for anything it cannot reach, including any attempt to leave the data — a
 * path through `constructor` or `__proto__` resolves to nothing rather than to a function.
 */
function resolvePath(context: unknown, path: string): unknown {
  let current = context;

  for (const segment of path.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment) || current === null || typeof current !== "object") {
      return undefined;
    }

    // `hasOwn` rather than `in`: an inherited property is not part of the received data.
    if (!Object.hasOwn(current, segment)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * How a resolved value reads once substituted into text.
 *
 * Objects and arrays become JSON rather than `[object Object]`, which is at least inspectable when
 * someone has pointed a template at a branch instead of a leaf.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function renderTemplate(template: string, context: unknown): RenderedTemplate {
  const unresolved: string[] = [];

  const text = template.replace(VARIABLE_PATTERN, (whole, path: string) => {
    const value = resolvePath(context, path);

    if (value === undefined) {
      unresolved.push(path);
      // Left as written, so an unresolved variable is visible in the output rather than silently
      // becoming a gap — a template that renders `Hi ,` reads like a bug in the flow, not the data.
      return whole;
    }

    return stringify(value);
  });

  return { text, unresolved };
}

/** Whether a value is worth offering as a variable, as opposed to a branch to descend into. */
function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function toPreview(value: unknown): string {
  const rendered = stringify(value);

  return rendered.length > templates.previewLength ? `${rendered.slice(0, templates.previewLength)}…` : rendered;
}

/**
 * Turns a received payload into the list of variables a step can refer to.
 *
 * Leaves only: `{{user}}` on an object would substitute a blob of JSON, which is almost never what
 * someone means, so the picker offers `{{user.email}}` and lets them type the other thing if they
 * really want it.
 */
export function listSampleVariables(sample: unknown): TemplateVariable[] {
  const variables: TemplateVariable[] = [];

  function walk(value: unknown, path: string[], depth: number): void {
    if (variables.length >= templates.maxSampleVariables || depth > templates.maxSampleDepth) {
      return;
    }

    if (isLeaf(value)) {
      if (path.length > 0) {
        variables.push({
          path: path.join("."),
          label: path.join(" › "),
          preview: toPreview(value),
        });
      }

      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!FORBIDDEN_SEGMENTS.has(key)) {
        walk(child, [...path, key], depth + 1);
      }
    }
  }

  walk(sample, [], 0);

  return variables;
}

/** Wraps a path in the delimiters, so nothing else has to know what they are. */
export function toTemplateToken(path: string): string {
  return `${templates.openDelimiter}${path}${templates.closeDelimiter}`;
}
