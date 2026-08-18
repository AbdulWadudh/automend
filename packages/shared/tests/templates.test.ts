import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import { listSampleVariables, listTemplateVariables, renderTemplate, toTemplateToken } from "../src/templates";

/**
 * The delivery in the request that prompted this: a webhook posts a payload, and a step's fields
 * refer to it by name.
 */
const delivery = {
  email: "abdulwadudh5@gmail.com",
  name: "Abdul Wadudh",
  dob: "17-08-2028",
  message: "Congrats on the Birthday",
  from: "Samdani",
};

describe("rendering a template", () => {
  test("substitutes a named value", () => {
    expect(renderTemplate("Hi {{name}}", delivery).text).toBe("Hi Abdul Wadudh");
  });

  test("renders the worked example end to end", () => {
    const body = "Hi {{name}}, {{message}}\n\nWith Regards\n{{from}}";

    expect(renderTemplate(body, delivery).text).toBe(
      "Hi Abdul Wadudh, Congrats on the Birthday\n\nWith Regards\nSamdani",
    );
  });

  test("substitutes inside a longer field, leaving the rest alone", () => {
    // The recipients case: a variable and a literal address in one comma-separated field.
    expect(renderTemplate("{{email}}, abdulwadudh@gmail.com", delivery).text).toBe(
      "abdulwadudh5@gmail.com, abdulwadudh@gmail.com",
    );
  });

  test("tolerates spaces inside the braces", () => {
    expect(renderTemplate("Hi {{ name }}", delivery).text).toBe("Hi Abdul Wadudh");
  });

  test("substitutes every occurrence of the same variable", () => {
    expect(renderTemplate("{{name}} and {{name}}", delivery).text).toBe("Abdul Wadudh and Abdul Wadudh");
  });

  test("reaches a nested value by path", () => {
    const nested = { user: { address: { city: "Hyderabad" } }, items: [{ sku: "A-1" }] };

    expect(renderTemplate("{{user.address.city}}", nested).text).toBe("Hyderabad");
    expect(renderTemplate("{{items.0.sku}}", nested).text).toBe("A-1");
  });

  test("renders non-strings readably", () => {
    const values = { count: 3, active: true, missing: null, tags: ["a", "b"] };

    expect(renderTemplate("{{count}}/{{active}}/{{missing}}/{{tags}}", values).text).toBe('3/true//["a","b"]');
  });

  test("leaves an unknown variable visible and reports it", () => {
    // Rendering it away would produce "Hi ," — which reads as a broken flow rather than as a
    // template pointing at a field the payload does not have.
    const result = renderTemplate("Hi {{nickname}}", delivery);

    expect(result.text).toBe("Hi {{nickname}}");
    expect(result.unresolved).toEqual(["nickname"]);
  });

  test("a template with no variables is returned unchanged", () => {
    expect(renderTemplate("plain text", delivery).text).toBe("plain text");
    expect(renderTemplate("", delivery).text).toBe("");
  });
});

describe("what a template is not allowed to do", () => {
  test("cannot reach the prototype chain", () => {
    for (const path of ["__proto__", "constructor", "constructor.name", "user.__proto__.polluted"]) {
      const result = renderTemplate(`{{${path}}}`, { user: {} });

      expect(result.text).toBe(`{{${path}}}`);
      expect(result.unresolved).toEqual([path]);
    }
  });

  test("cannot read an inherited property", () => {
    const inherited = Object.create({ secret: "from the prototype" }) as Record<string, unknown>;
    inherited.own = "visible";

    expect(renderTemplate("{{secret}}", inherited).unresolved).toEqual(["secret"]);
    expect(renderTemplate("{{own}}", inherited).text).toBe("visible");
  });

  test("is not an expression language", () => {
    // None of these are syntax. They are text that happens to contain braces, and must stay text.
    for (const attempt of ["{{1 + 1}}", "{{name.toUpperCase()}}", "{{ name || 'x' }}", "{{a b}}"]) {
      expect(renderTemplate(attempt, delivery).text).toBe(attempt);
    }
  });

  test("a context that is not an object resolves nothing", () => {
    for (const context of [null, undefined, "a string", 42]) {
      expect(renderTemplate("{{name}}", context).unresolved).toEqual(["name"]);
    }
  });
});

describe("listing the variables a template uses", () => {
  test("finds each one once, in order", () => {
    expect(listTemplateVariables("Hi {{name}}, {{message}} — {{name}}")).toEqual(["name", "message"]);
  });

  test("finds none in plain text", () => {
    expect(listTemplateVariables("no variables here")).toEqual([]);
  });
});

/**
 * The invariant that was missing, and whose absence let a real bug ship.
 *
 * The picker's job is to insert a path the engine can resolve. It was called on a webhook's *body*, so it
 * offered `{{email}}` — while the engine resolves against `{ trigger, steps }`, where that value lives at
 * `trigger.body.email`. Every chip the builder inserted was unresolvable, the literal `{{email}}` was sent to
 * Gmail, and it came back as `Invalid To header`.
 *
 * Asserting specific paths could never have caught that: each half was self-consistent. Only round-tripping
 * the two together does.
 */
describe("every variable offered is one that resolves", () => {
  const { triggerVariablePrefix, stepsVariablePrefix } = config.flows.templates;

  /** The shape a webhook trigger actually produces, and the context the engine builds around it. */
  const payload = { body: delivery, method: "POST", path: "incoming", query: null, headers: { host: "x" } };
  const context = { [triggerVariablePrefix]: payload, [stepsVariablePrefix]: {} };

  test("with the trigger prefix, nothing the picker offers is unresolvable", () => {
    const variables = listSampleVariables(payload, triggerVariablePrefix);

    expect(variables.length).toBeGreaterThan(0);

    for (const variable of variables) {
      const rendered = renderTemplate(toTemplateToken(variable.path), context);

      expect(rendered.unresolved).toEqual([]);
      // And it must substitute the actual value, not merely fail to complain.
      expect(rendered.text).not.toContain(config.flows.templates.openDelimiter);
    }
  });

  /**
   * Rewritten, and the rewrite is the record of a decision.
   *
   * This used to assert that an unprefixed path was *unresolvable*, which is what made the picker's omission
   * fatal. It is now resolvable on purpose: `{{email}}` is what somebody writes having just posted a body with
   * an `email` field, and a rule the data gives no hint of is a rule that gets broken. What must hold is that
   * the shorthand and the explicit form reach the *same value* — two spellings, never two meanings.
   */
  test("a rootless path reaches the same value the explicit one does", () => {
    const variables = listSampleVariables(payload);

    expect(variables.length).toBeGreaterThan(0);

    for (const variable of variables) {
      const shorthand = renderTemplate(toTemplateToken(variable.path), context);
      const explicit = renderTemplate(toTemplateToken(`${triggerVariablePrefix}.${variable.path}`), context);

      expect(shorthand.unresolved).toEqual([]);
      expect(shorthand.text).toBe(explicit.text);
    }
  });

  test("a name that is in neither place is still reported", () => {
    // The fallbacks widen where a path is looked for; they must not turn a genuine miss into silence.
    expect(renderTemplate("{{noSuchField}}", context).unresolved).toEqual(["noSuchField"]);
  });

  test("a body field shadows an envelope field of the same name", () => {
    // The tie-break, asserted rather than left to the order of a config array: the body is the part the author
    // controls, so it is what a bare name means.
    const collides = { [triggerVariablePrefix]: { body: { method: "from-the-body" }, method: "POST" } };

    expect(renderTemplate("{{method}}", collides).text).toBe("from-the-body");
    // ...and the explicit path still reaches exactly what it names.
    expect(renderTemplate(`{{${triggerVariablePrefix}.method}}`, collides).text).toBe("POST");
  });

  test("an explicit root is never rewritten, so a wrong explicit path fails loudly", () => {
    // `{{trigger.email}}` names a place that does not exist. Silently falling back to `trigger.body.email`
    // would make the two roots interchangeable and the explicit form meaningless.
    expect(renderTemplate(`{{${triggerVariablePrefix}.email}}`, context).unresolved).toEqual([
      `${triggerVariablePrefix}.email`,
    ]);
  });

  test("the prefix is added to the path and kept out of the label", () => {
    // The label names the field for somebody reading a menu; repeating the context root in it is noise.
    const [first] = listSampleVariables({ body: { email: "a@b.c" } }, triggerVariablePrefix);

    expect(first?.path).toBe(`${triggerVariablePrefix}.body.email`);
    expect(first?.label).toBe("body › email");
  });

  test("a deeply nested value survives the prefix", () => {
    // The prefix is applied after the walk, so it cannot push a field past `maxSampleDepth` and out of the menu.
    const deep = { body: { a: { b: { c: { d: { e: "found" } } } } } };
    const paths = listSampleVariables(deep, triggerVariablePrefix).map((variable) => variable.path);

    expect(paths).toContain(`${triggerVariablePrefix}.body.a.b.c.d.e`);
  });
});

describe("offering variables from a received payload", () => {
  test("lists every leaf with a preview", () => {
    const variables = listSampleVariables(delivery);

    expect(variables.map((variable) => variable.path)).toEqual(["email", "name", "dob", "message", "from"]);
    expect(variables[1]).toMatchObject({ path: "name", preview: "Abdul Wadudh" });
  });

  test("descends into nested data and names the path", () => {
    const variables = listSampleVariables({ user: { email: "a@b.c" }, items: [{ sku: "A-1" }] });

    expect(variables.map((variable) => variable.path)).toEqual(["user.email", "items.0.sku"]);
    expect(variables[0]?.label).toBe("user › email");
  });

  test("offers leaves rather than the branches above them", () => {
    // `{{user}}` would substitute a blob of JSON, which is almost never what someone means.
    expect(listSampleVariables({ user: { email: "a@b.c" } }).map((v) => v.path)).not.toContain("user");
  });

  test("every offered variable actually resolves", () => {
    for (const variable of listSampleVariables(delivery)) {
      expect(renderTemplate(toTemplateToken(variable.path), delivery).unresolved).toEqual([]);
    }
  });

  test("a large payload cannot produce an unusable menu", () => {
    const wide = Object.fromEntries(
      Array.from({ length: config.flows.templates.maxSampleVariables * 2 }, (_, index) => [`field${index}`, index]),
    );

    expect(listSampleVariables(wide).length).toBeLessThanOrEqual(config.flows.templates.maxSampleVariables);
  });

  test("deeply nested data does not recurse without end", () => {
    let deep: Record<string, unknown> = { value: "bottom" };

    for (let index = 0; index < config.flows.templates.maxSampleDepth * 3; index += 1) {
      deep = { nested: deep };
    }

    expect(() => listSampleVariables(deep)).not.toThrow();
  });

  test("a payload that is not an object offers nothing", () => {
    expect(listSampleVariables("a string")).toEqual([]);
    expect(listSampleVariables(null)).toEqual([]);
  });
});

describe("a rich-text body", () => {
  // The email body is stored as HTML with tokens in it. Substitution is string-level, so the
  // markup is carried through untouched — the renderer neither parses nor escapes it.
  const body = "<p>Hi <strong>{{name}}</strong>, {{message}}.</p><p>Regards,<br>{{from}}</p>";

  test("substitutes inside markup without disturbing it", () => {
    expect(renderTemplate(body, delivery).text).toBe(
      "<p>Hi <strong>Abdul Wadudh</strong>, Congrats on the Birthday.</p><p>Regards,<br>Samdani</p>",
    );
  });

  test("a variable inside a list item is substituted like any other", () => {
    const list = "<ul><li>{{name}}</li><li>{{email}}</li></ul>";

    expect(renderTemplate(list, delivery).text).toBe("<ul><li>Abdul Wadudh</li><li>abdulwadudh5@gmail.com</li></ul>");
  });

  test("markup in the data is substituted verbatim, not interpreted", () => {
    // Worth stating: the renderer does not escape. Whatever protects the recipient has to be the
    // step that sends, which knows whether it is producing HTML or plain text.
    const injected = renderTemplate("<p>{{name}}</p>", { name: "<script>alert(1)</script>" });

    expect(injected.text).toBe("<p><script>alert(1)</script></p>");
  });
});
