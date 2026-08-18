import { describe, expect, test } from "bun:test";
import { createAction } from "../src/action";
import { deepFreeze } from "../src/freeze";
import { createKit } from "../src/kit";
import { Property } from "../src/property";

/**
 * These are the mutations a shallow `Object.freeze(kit)` would have let through, which is the whole
 * reason freezing happens once over the finished tree instead of in each factory.
 */
describe("deep-freezing the registry", () => {
  const kits = deepFreeze([
    createKit({
      id: "http",
      displayName: "HTTP",
      description: "Call a URL",
      actions: [
        createAction({
          name: "request",
          displayName: "Request",
          description: "Calls a URL",
          props: {
            method: Property.staticDropdown({
              displayName: "Method",
              options: [{ label: "GET", value: "GET" }],
            }),
          },
          run: async () => undefined,
        }),
      ],
    }),
  ]);

  const kit = kits[0];
  const action = kit?.actions[0];
  const method = action?.props.method;

  test("the kit list itself cannot be added to", () => {
    expect(Object.isFrozen(kits)).toBe(true);
  });

  test("a kit's action array cannot be added to", () => {
    expect(Object.isFrozen(kit?.actions)).toBe(true);
  });

  test("a property's options cannot be changed", () => {
    expect(method?.type).toBe("staticDropdown");
    expect(Object.isFrozen(method?.type === "staticDropdown" ? method.options : undefined)).toBe(true);
  });

  test("in strict mode a mutation throws rather than being ignored", () => {
    expect(() => {
      // Reaching past `readonly` deliberately: the point of this test is what happens when the
      // compiler is not watching, which is exactly the registry's situation.
      (kit as unknown as Record<string, unknown>).id = "gmail";
    }).toThrow();
  });

  test("a cycle does not send it into infinite recursion", () => {
    const looped: Record<string, unknown> = {};
    looped.self = looped;

    expect(() => deepFreeze(looped)).not.toThrow();
    expect(Object.isFrozen(looped)).toBe(true);
  });
});
