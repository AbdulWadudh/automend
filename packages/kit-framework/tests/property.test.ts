import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { Property } from "../src/property";

describe("what a property records", () => {
  test("optional unless the kit says otherwise", () => {
    expect(Property.shortText({ displayName: "Subject" }).required).toBe(false);
    expect(Property.shortText({ displayName: "Subject", required: true }).required).toBe(true);
  });

  test("a dropdown keeps its options", () => {
    const method = Property.staticDropdown({
      displayName: "Method",
      options: [{ label: "GET", value: "GET" }],
    });

    expect(method.options).toEqual([{ label: "GET", value: "GET" }]);
  });
});

/**
 * Templatability is decided by type rather than by the kit author, so this is where that decision is
 * pinned down. A toggle and a dropdown have nowhere to type a variable into; everything else is a
 * text field in the builder, `number` included.
 */
describe("which properties accept a variable", () => {
  test("text, number and json do", () => {
    expect(Property.shortText({ displayName: "To" }).templatable).toBe(true);
    expect(Property.longText({ displayName: "Body" }).templatable).toBe(true);
    expect(Property.number({ displayName: "Copies" }).templatable).toBe(true);
    expect(Property.json({ displayName: "Payload" }).templatable).toBe(true);
  });

  test("a checkbox and a dropdown do not", () => {
    expect(Property.checkbox({ displayName: "Urgent" }).templatable).toBe(false);
    expect(Property.staticDropdown({ displayName: "Method", options: [] }).templatable).toBe(false);
  });

  test("every configured property type has a constructor", () => {
    const constructed = [
      Property.shortText({ displayName: "a" }),
      Property.longText({ displayName: "b" }),
      Property.number({ displayName: "c" }),
      Property.checkbox({ displayName: "d" }),
      Property.staticDropdown({ displayName: "e", options: [] }),
      Property.json({ displayName: "f" }),
    ].map((property) => property.type);

    expect(constructed.toSorted()).toEqual([...config.kits.propertyTypes].toSorted());
  });
});
