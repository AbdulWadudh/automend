import { describe, expect, test } from "bun:test";
import { createAction } from "../src/action";
import { requireOAuthToken, requireToken } from "../src/context";
import { Property } from "../src/property";
import { createFakeInvocation } from "./support/fake-invocation";

describe("createAction", () => {
  test("hands the author the input the engine resolved", async () => {
    const action = createAction({
      name: "greet",
      displayName: "Greet",
      description: "Says hello",
      props: { name: Property.shortText({ displayName: "Name", required: true }) },
      run: async (context) => `hello ${context.input.name}`,
    });

    expect(await action.invoke(createFakeInvocation({ input: { name: "Ada" } }))).toBe("hello Ada");
  });

  test("exposes its properties for the catalogue to describe", () => {
    const action = createAction({
      name: "greet",
      displayName: "Greet",
      description: "Says hello",
      props: { name: Property.shortText({ displayName: "Name" }) },
      run: async () => undefined,
    });

    expect(Object.keys(action.props)).toEqual(["name"]);
  });
});

/**
 * A kit reading `ctx.auth?.accessToken` and sending `undefined` upstream fails somewhere far away and
 * for the wrong reason. These say what is wrong, and name the step the author has to go and fix.
 */
describe("insisting on a credential", () => {
  test("an OAuth token is returned when the connection is one", () => {
    const context = createFakeInvocation({ auth: { kind: "oauth", connectorId: "google", accessToken: "token" } });

    expect(requireOAuthToken(context)).toBe("token");
  });

  test("a missing connection names the step rather than failing upstream", () => {
    const context = createFakeInvocation({ stepName: "Send the receipt" });

    expect(() => requireOAuthToken(context)).toThrow(/Send the receipt/);
  });

  test("the wrong kind of connection is refused, not coerced", () => {
    const context = createFakeInvocation({ auth: { kind: "token", connectorId: "apiToken", token: "secret" } });

    expect(() => requireOAuthToken(context)).toThrow(/OAuth/);
    expect(requireToken(context)).toBe("secret");
  });
});
