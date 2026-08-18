import { describe, expect, test } from "bun:test";
import { Property } from "@automend/kit-framework";
import { config } from "@automend/shared";
import {
  buildResolutionContext,
  buildStepVariableKeys,
  listStepVariables,
  resolveStepInput,
  stepVariableKey,
  withStepOutput,
} from "../../src/engine/resolve-input";

/**
 * Substitution then coercion, in that order, and the order is the point: `{{orderCount}}` is text until the flow
 * has data, and a number only after. These are pure, which is why they live in the parent process rather than in
 * the subprocess — the last place a step can be refused before it touches the outside world.
 */

const props = {
  to: Property.shortText({ displayName: "To", required: true }),
  subject: Property.shortText({ displayName: "Subject" }),
  copies: Property.number({ displayName: "Copies", minimum: 1, maximum: 5 }),
  urgent: Property.checkbox({ displayName: "Urgent" }),
  method: Property.staticDropdown({
    displayName: "Method",
    options: [
      { label: "GET", value: "GET" },
      { label: "POST", value: "POST" },
    ],
  }),
};

const delivery = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: { orderId: "A-1024", customer: { email: "ada@example.com" }, quantity: 3 },
};

function resolve(stored: Record<string, unknown>, context = buildResolutionContext(delivery)) {
  return resolveStepInput(props, stored, context);
}

/**
 * The other half of the picker invariant.
 *
 * `packages/shared` asserts that every path the builder offers carries `config.flows.templates
 * .triggerVariablePrefix`; this asserts that the prefix is what the engine actually keys the context by. Neither
 * test alone would have caught the two disagreeing, which is how `{{email}}` reached Gmail as a literal.
 */
describe("the context keys are the ones the builder writes paths against", () => {
  test("the trigger's payload sits under the configured prefix", () => {
    const context = buildResolutionContext(delivery) as Record<string, unknown>;

    expect(context[config.flows.templates.triggerVariablePrefix]).toBe(delivery);
  });

  test("step outputs sit under the configured prefix", () => {
    const context = withStepOutput(buildResolutionContext(delivery), "lookUpTheOrder", { total: 42 }) as Record<
      string,
      unknown
    >;

    expect(context[config.flows.templates.stepsVariablePrefix]).toEqual({ lookUpTheOrder: { total: 42 } });
  });
});

describe("what a variable can refer to", () => {
  test("the trigger's whole payload, not just its body", () => {
    const result = resolve({ to: "{{trigger.body.customer.email}}", subject: "{{trigger.method}}" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.resolved.input.to).toBe("ada@example.com");
      // The headers and the method are often the interesting part of a webhook, so they are reachable too.
      expect(result.resolved.input.subject).toBe("POST");
    }
  });

  /**
   * Keyed by a slug of the step's name, not the name itself. A name is free text — "Look up the order" has spaces
   * that the path grammar does not admit, and "Total (2.5)" has a dot that would split the path in the wrong
   * place — so the handle is derived rather than used raw.
   */
  test("an earlier step's output, by the handle derived from its name", () => {
    const key = stepVariableKey("Look up the order");
    const context = withStepOutput(buildResolutionContext(delivery), key, { total: 42 });
    const result = resolve({ to: "a@b.c", subject: `Total {{steps.${key}.total}}` }, context);

    expect(key).toBe("lookUpTheOrder");
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.resolved.input.subject).toBe("Total 42");
    }
  });

  test("text around a variable is preserved", () => {
    const result = resolve({ to: "a@b.c", subject: "Order {{trigger.body.orderId}} received" });

    expect(result.ok && result.resolved.input.subject).toBe("Order A-1024 received");
  });

  test("several variables in one field all resolve", () => {
    const result = resolve({
      to: "a@b.c",
      subject: "{{trigger.body.orderId}} for {{trigger.body.customer.email}}",
    });

    expect(result.ok && result.resolved.input.subject).toBe("A-1024 for ada@example.com");
  });
});

/**
 * These used to assert the opposite, and the change is the point.
 *
 * The old behaviour rendered a missing variable as the literal `{{name}}` it was written as and carried on,
 * reasoning that a required field would catch it. It does not: `"{{email}}"` is a non-empty string, so the
 * required check passes and the literal is handed to the kit. In production that reached Gmail, which answered
 * `HTTP 400 — Invalid To header` — a message that names neither the field nor the variable, and on a second
 * attempt came back as a closed socket instead. Neither told the author that `{{email}}` was the problem.
 *
 * There is no reading under which `{{name}}` is a value somebody meant to transmit, so the step is refused
 * before anything leaves the process.
 */
describe("a variable the data did not contain", () => {
  test("stops the step instead of sending the literal onward", () => {
    const result = resolve({ to: "a@b.c", subject: "Hello {{trigger.body.nickname}}" });

    expect(result.ok).toBe(false);
  });

  test("names the variable, because that is the only thing the author can act on", () => {
    const result = resolve({ to: "{{trigger.body.nickname}}" });

    if (result.ok) {
      throw new Error("expected the resolution to fail");
    }

    expect(result.failure.message).toContain("{{trigger.body.nickname}}");
    expect(result.failure.unresolved).toEqual(["trigger.body.nickname"]);
  });

  test("names every missing variable at once, not just the first", () => {
    // An author fixing one variable per run is an author running the flow four times to learn four things.
    const result = resolve({ to: "{{trigger.body.email}}", subject: "{{trigger.body.subject}}" });

    if (result.ok) {
      throw new Error("expected the resolution to fail");
    }

    expect(result.failure.unresolved).toEqual(["trigger.body.email", "trigger.body.subject"]);
    expect(result.failure.message).toContain("{{trigger.body.email}}");
    expect(result.failure.message).toContain("{{trigger.body.subject}}");
  });

  test("a variable that does resolve is left alone", () => {
    // The guard must not fire on a template that worked, which is every template in a working flow.
    const result = resolve({ to: "a@b.c", subject: "Order {{trigger.body.orderId}}" });

    if (!result.ok) {
      throw new Error(`expected the resolution to succeed, got: ${result.failure.message}`);
    }

    expect(result.resolved.input.subject).toBe("Order A-1024");
  });
});

describe("coercion after substitution", () => {
  test("a number arrives as the text it resolved to and comes out a number", () => {
    const result = resolve({ to: "a@b.c", copies: "{{trigger.body.quantity}}" });

    expect(result.ok && result.resolved.input.copies).toBe(3);
  });

  test("a resolved value outside the declared range is refused", () => {
    const result = resolve({ to: "a@b.c", copies: "99" });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.message).toContain("copies");
    }
  });

  test("a missing required field is refused before the subprocess is involved", () => {
    const result = resolve({ subject: "no recipient" });

    expect(result.ok).toBe(false);
  });

  test("a non-templatable field keeps its declared type and is not substituted into", () => {
    const result = resolve({ to: "a@b.c", urgent: true, method: "POST" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.resolved.input.urgent).toBe(true);
      expect(result.resolved.input.method).toBe("POST");
    }
  });

  test("a dropdown value outside its options is refused", () => {
    expect(resolve({ to: "a@b.c", method: "TRACE" }).ok).toBe(false);
  });
});

describe("a step's declared variables", () => {
  /** Recorded in the journal, so a run whose data arrived in a different shape is diagnosable. */
  test("are listed whether or not they resolve, without duplicates", () => {
    const variables = listStepVariables(props, {
      to: "{{trigger.body.customer.email}}",
      subject: "{{trigger.body.orderId}} and {{trigger.body.orderId}}",
      urgent: true,
    });

    expect(variables.toSorted()).toEqual(["trigger.body.customer.email", "trigger.body.orderId"]);
  });

  test("a non-templatable field contributes none, even if its value looks like one", () => {
    expect(listStepVariables(props, { method: "{{trigger.method}}" })).toEqual([]);
  });
});

describe("the handle a template uses for a step", () => {
  test("is the name in camelCase, with anything a path cannot carry removed", () => {
    expect(stepVariableKey("Look up the order")).toBe("lookUpTheOrder");
    expect(stepVariableKey("Send email")).toBe("sendEmail");
    // A dot in a name would otherwise split the path in the wrong place and resolve to nothing.
    expect(stepVariableKey("Total (2.5)")).toBe("total25");
    expect(stepVariableKey("HTTP request")).toBe("hTTPRequest");
  });

  test("a name with nothing to derive from still gets a usable handle", () => {
    expect(stepVariableKey("...")).toBe("step");
    expect(stepVariableKey("")).toBe("step");
  });

  /**
   * Two steps that slug identically would have one silently shadowing the other, which makes a template resolve
   * against the wrong step's output — a bug that looks like the flow working.
   */
  test("colliding names are made unique, in definition order", () => {
    const keys = buildStepVariableKeys([
      { id: "a", name: "Send email" },
      { id: "b", name: "Send Email" },
      { id: "c", name: "send-email" },
    ]);

    expect([...keys.values()]).toEqual(["sendEmail", "sendEmail2", "sendEmail3"]);
  });

  test("the same flow always produces the same handles, so a retry resolves as the first attempt did", () => {
    const steps = [
      { id: "a", name: "One" },
      { id: "b", name: "Two" },
    ];

    expect([...buildStepVariableKeys(steps)]).toEqual([...buildStepVariableKeys(steps)]);
  });
});

describe("the resolution context", () => {
  test("starts with the trigger and no steps", () => {
    const context = buildResolutionContext(delivery);

    expect(context.trigger).toEqual(delivery);
    expect(context.steps).toEqual({});
  });

  test("adding a step's output leaves the previous context alone", () => {
    const first = buildResolutionContext(delivery);
    const second = withStepOutput(first, "One", { a: 1 });

    expect(first.steps).toEqual({});
    expect(second.steps).toEqual({ One: { a: 1 } });
  });
});
