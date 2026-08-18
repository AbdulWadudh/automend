import { describe, expect, test } from "bun:test";
import { buildResolvedInputSchema, buildStoredInputSchema } from "../src/input-schema";
import { type InputPropertyMap, Property } from "../src/property";

/**
 * The two-schema split is the framework's load-bearing idea, so this is the file to read first: a
 * templatable field is text at rest and its declared type only once the flow has data. Getting it
 * wrong in either direction is a real failure — reject `{{count}}` on save and the builder cannot
 * store work in progress; accept `"abc"` at run time and a kit is handed a number that is not one.
 */

const props = {
  to: Property.shortText({ displayName: "To", required: true }),
  copies: Property.number({ displayName: "Copies", defaultValue: 1 }),
  urgent: Property.checkbox({ displayName: "Urgent", defaultValue: false }),
  method: Property.staticDropdown({
    displayName: "Method",
    required: true,
    options: [
      { label: "GET", value: "GET" },
      { label: "POST", value: "POST" },
    ],
  }),
  payload: Property.json({ displayName: "Payload" }),
} satisfies InputPropertyMap;

const stored = buildStoredInputSchema(props);
const resolved = buildResolvedInputSchema(props);

describe("what the builder is allowed to save", () => {
  test("a templatable field may hold a variable instead of its declared type", () => {
    const result = stored.safeParse({ to: "{{customer.email}}", copies: "{{order.quantity}}" });

    expect(result.success).toBe(true);
  });

  test("a half-configured step saves, because that is a normal state to be in", () => {
    expect(stored.safeParse({}).success).toBe(true);
  });

  test("a non-templatable field still has to be the right type", () => {
    expect(stored.safeParse({ urgent: "yes" }).success).toBe(false);
    expect(stored.safeParse({ method: "TRACE" }).success).toBe(false);
  });

  test("a key from a property the kit has since removed is dropped rather than rejected", () => {
    const result = stored.safeParse({ to: "ada@example.com", removedLastYear: "value" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ to: "ada@example.com" });
  });
});

describe("what the engine is allowed to run", () => {
  test("a number arrives as the text a template resolved to and comes out a number", () => {
    const result = resolved.safeParse({ to: "ada@example.com", method: "GET", copies: "3" });

    expect(result.success).toBe(true);
    expect(result.data?.copies).toBe(3);
  });

  test("text that is not a number is refused rather than coerced to NaN", () => {
    expect(resolved.safeParse({ to: "ada@example.com", method: "GET", copies: "abc" }).success).toBe(false);
  });

  test("a missing required field fails here, having been allowed on save", () => {
    expect(stored.safeParse({ method: "GET" }).success).toBe(true);
    expect(resolved.safeParse({ method: "GET" }).success).toBe(false);
  });

  /** The trap `z.coerce.number()` sets: `Number("")` is 0, so a cleared field would become a value. */
  test("a cleared field is absent, not zero and not empty string", () => {
    const result = resolved.safeParse({ to: "ada@example.com", method: "GET", copies: "" });

    expect(result.success).toBe(true);
    expect(result.data?.copies).toBe(1);
  });

  test("a cleared required field fails instead of passing as empty text", () => {
    expect(resolved.safeParse({ to: "", method: "GET" }).success).toBe(false);
  });

  test("a default is applied in resolved space, not as text", () => {
    const result = resolved.safeParse({ to: "ada@example.com", method: "GET" });

    expect(result.data?.copies).toBe(1);
    expect(result.data?.urgent).toBe(false);
  });

  test("json is parsed from the text the field holds", () => {
    const result = resolved.safeParse({ to: "a@b.c", method: "GET", payload: '{"sku":"A1"}' });

    expect(result.success).toBe(true);
    expect(result.data?.payload).toEqual({ sku: "A1" });
  });

  test("json that will not parse is reported, not thrown", () => {
    expect(resolved.safeParse({ to: "a@b.c", method: "GET", payload: "{oops" }).success).toBe(false);
  });

  test("a dropdown only accepts its own options", () => {
    expect(resolved.safeParse({ to: "a@b.c", method: "POST" }).success).toBe(true);
    expect(resolved.safeParse({ to: "a@b.c", method: "DELETE" }).success).toBe(false);
  });
});

describe("a dropdown declared with no options", () => {
  /**
   * `createKit` rejects this, so it should be unreachable — but the schema builder still has to be
   * total, and accepting anything would be the wrong way to be.
   */
  test("accepts nothing rather than everything", () => {
    const schema = buildResolvedInputSchema({
      broken: Property.staticDropdown({ displayName: "Broken", required: true, options: [] }),
    });

    expect(schema.safeParse({ broken: "anything" }).success).toBe(false);
  });
});
