import { describe, expect, test } from "bun:test";
import { createAction } from "../src/action";
import { createKit, kitOAuth } from "../src/kit";
import { Property } from "../src/property";
import { createTrigger } from "../src/trigger";

/**
 * These checks run when a kit module is imported, so a malformed kit stops the process at start-up
 * rather than surfacing as an inexplicable validation error the first time somebody uses it.
 */

function action(name: string, props = {}) {
  return createAction({
    name,
    displayName: name,
    description: "does something",
    props,
    run: async () => undefined,
  });
}

function trigger(name: string) {
  return createTrigger({
    name,
    displayName: name,
    description: "starts a flow",
    strategy: "webhook",
    props: {},
    sampleData: {},
  });
}

describe("a well-formed kit", () => {
  test("keeps what it was given", () => {
    const kit = createKit({
      id: "gmail",
      displayName: "Gmail",
      description: "Email by Google",
      auth: kitOAuth({ connectorId: "google", scopes: ["https://www.googleapis.com/auth/gmail.send"] }),
      actions: [action("sendEmail")],
      triggers: [trigger("newEmail")],
    });

    expect(kit.auth?.connectorId).toBe("google");
    expect(kit.actions.map((entry) => entry.name)).toEqual(["sendEmail"]);
  });

  test("needs no auth, and says so rather than pretending to some", () => {
    expect(createKit({ id: "core", displayName: "Core", description: "Built in" }).auth).toBeUndefined();
  });
});

describe("names", () => {
  test("a kebab-case id is rejected, because ids are camelCase identifiers", () => {
    expect(() => createKit({ id: "google-sheets", displayName: "Sheets", description: "" })).toThrow(/camelCase/);
  });

  test("a kebab-case action name is rejected too", () => {
    expect(() =>
      createKit({ id: "gmail", displayName: "Gmail", description: "", actions: [action("send-email")] }),
    ).toThrow(/camelCase/);
  });

  test("camelCase with digits is fine", () => {
    expect(() => createKit({ id: "oauth2", displayName: "OAuth 2", description: "" })).not.toThrow();
  });

  test("two actions cannot share a name", () => {
    expect(() =>
      createKit({
        id: "gmail",
        displayName: "Gmail",
        description: "",
        actions: [action("sendEmail"), action("sendEmail")],
      }),
    ).toThrow(/declared twice/);
  });

  test("an action and a trigger may share a name, since a flow never confuses the two", () => {
    expect(() =>
      createKit({
        id: "gmail",
        displayName: "Gmail",
        description: "",
        actions: [action("newEmail")],
        triggers: [trigger("newEmail")],
      }),
    ).not.toThrow();
  });
});

describe("a dropdown with no options", () => {
  /** It could never validate, so the kit is wrong rather than the eventual flow. */
  test("is refused at construction, naming the property", () => {
    expect(() =>
      createKit({
        id: "gmail",
        displayName: "Gmail",
        description: "",
        actions: [action("sendEmail", { label: Property.staticDropdown({ displayName: "Label", options: [] }) })],
      }),
    ).toThrow(/gmail\.sendEmail\.label/);
  });
});
