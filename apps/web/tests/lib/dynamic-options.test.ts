import { describe, expect, test } from "bun:test";
import {
  findUnmetDependencies,
  isMissing,
  isStaleSelection,
  narrowToDependencies,
} from "../../src/lib/dynamic-options";

describe("deciding whether a dynamic dropdown may ask", () => {
  test("a dropdown that depends on nothing is always ready", () => {
    expect(findUnmetDependencies({}, undefined)).toEqual([]);
    expect(findUnmetDependencies({}, [])).toEqual([]);
  });

  test("names the fields still to fill in, so the notice can say which", () => {
    expect(findUnmetDependencies({ sheetId: "abc" }, ["sheetId", "tab"])).toEqual(["tab"]);
  });

  /** An empty field is not a value: asking for "the tabs in spreadsheet ''" wastes a call to fail. */
  test("treats blank, null and undefined alike", () => {
    expect(isMissing("")).toBe(true);
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing(false)).toBe(false);
    expect(isMissing(0)).toBe(false);
  });
});

/**
 * The narrowed input is the query key. Sending the whole step would refetch the channel list on every
 * keystroke in the message field — a request per character, against somebody else's rate limit.
 */
describe("what the request carries", () => {
  test("carries only what the loader reads", () => {
    const input = { channel: "C1", text: "a long message being typed", threadTs: "123" };

    expect(narrowToDependencies(input, ["channel"])).toEqual({ channel: "C1" });
  });

  test("is empty when the loader reads nothing, so unrelated edits cannot refetch", () => {
    const input = { text: "still typing" };

    expect(narrowToDependencies(input, [])).toEqual({});
    expect(narrowToDependencies(input, undefined)).toEqual({});
  });

  /**
   * The key has to change when a dependency is cleared, not merely when it is replaced — otherwise the
   * previous spreadsheet's tabs stay on screen after the spreadsheet is unset.
   */
  test("keeps a dependency that is absent, so clearing it is a different key", () => {
    expect(narrowToDependencies({}, ["sheetId"])).toEqual({ sheetId: undefined });
  });
});

describe("a saved value the service no longer offers", () => {
  const options = [
    { label: "#general", value: "C1" },
    { label: "#random", value: "C2" },
  ];

  test("is flagged, because the flow still holds it and the run would fail on it", () => {
    expect(isStaleSelection("C9", options)).toBe(true);
  });

  test("is not flagged when it is still there", () => {
    expect(isStaleSelection("C2", options)).toBe(false);
  });

  /** Nothing chosen yet is a normal state, not a stale one. */
  test("is not flagged when nothing is chosen", () => {
    expect(isStaleSelection("", options)).toBe(false);
  });
});
