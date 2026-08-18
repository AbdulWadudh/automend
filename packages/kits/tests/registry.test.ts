import { describe, expect, test } from "bun:test";
import { buildStoredInputSchema, KIT_NAME_PATTERN, toKitCatalogue } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { describeStepKind, findAction, findKit, findTrigger, kits } from "../src/registry";

/**
 * The registry is what makes "adding a service is adding a directory" true, so these are invariants over
 * *every* kit rather than tests of any one of them. A new kit that breaks one of these fails here rather
 * than in a flow somebody built.
 */

const everyAction = kits.flatMap((kit) => kit.actions.map((action) => ({ kit, action })));
const everyTrigger = kits.flatMap((kit) => kit.triggers.map((trigger) => ({ kit, trigger })));

describe("what the registry holds", () => {
  test("no two kits share an id, which would silently dispatch a step to the wrong service", () => {
    const ids = kits.map((kit) => kit.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every kit, action and trigger name is camelCase", () => {
    for (const kit of kits) {
      expect(kit.id).toMatch(KIT_NAME_PATTERN);
    }

    for (const { action } of everyAction) {
      expect(action.name).toMatch(KIT_NAME_PATTERN);
    }

    for (const { trigger } of everyTrigger) {
      expect(trigger.name).toMatch(KIT_NAME_PATTERN);
    }
  });

  test("every kit is usable: it has something to do or some way to start", () => {
    for (const kit of kits) {
      expect(kit.actions.length + kit.triggers.length).toBeGreaterThan(0);
    }
  });

  test("every kit says what it is for, so the step picker is never blank", () => {
    for (const kit of kits) {
      expect(kit.displayName.length).toBeGreaterThan(0);
      expect(kit.description.length).toBeGreaterThan(0);
    }
  });

  test("every action and trigger describes itself for the picker", () => {
    for (const { action } of everyAction) {
      expect(action.displayName.length).toBeGreaterThan(0);
      expect(action.description.length).toBeGreaterThan(0);
    }

    for (const { trigger } of everyTrigger) {
      expect(trigger.displayName.length).toBeGreaterThan(0);
      expect(trigger.description.length).toBeGreaterThan(0);
    }
  });

  /**
   * Without sample data the second step of a new flow has nothing to point a variable at, so an author
   * has to run the flow blind before they can configure it.
   */
  test("every trigger carries sample data for the variable picker", () => {
    for (const { trigger } of everyTrigger) {
      expect(trigger.sampleData).toBeDefined();
    }
  });

  test("every declared property produces a usable schema", () => {
    for (const { kit, action } of everyAction) {
      const schema = buildStoredInputSchema(action.props);

      // An empty step is savable by design, so this is the weakest possible check that the derivation
      // did not throw on any property the kit declared.
      expect(schema.safeParse({}).success).toBe(true);
      expect(describeStepKind(kit.id, action.name)).toBe(`${kit.id}.${action.name}`);
    }
  });

  test("a kit that needs credentials names a connector this platform actually has", () => {
    const known = config.connectors.providers.map((provider) => provider.id);

    for (const kit of kits) {
      if (kit.auth) {
        expect(known).toContain(kit.auth.connectorId);
      }
    }
  });

  /**
   * A kit promising a scope its connector does not request is a promise the platform cannot keep: the
   * connection would be authorised without it and the step would fail at the API with a scope error.
   */
  test("every scope a kit needs is one its connector requests", () => {
    for (const kit of kits) {
      if (kit.auth?.kind !== "oauth") {
        continue;
      }

      const connector = config.connectors.providers.find((provider) => provider.id === kit.auth?.connectorId);
      // Widened from the literal tuple `config` infers, so the assertion compares values rather than
      // asking whether an arbitrary string is one of the six scopes the catalogue happens to name today.
      const requested: readonly string[] = connector?.scopes ?? [];

      for (const scope of kit.auth.scopes) {
        expect(requested).toContain(scope);
      }
    }
  });
});

describe("looking a step up", () => {
  test("finds what is there", () => {
    expect(findKit("core")?.displayName).toBe("Core");
    expect(findAction("gmail", "sendEmail")?.displayName).toBe("Send email");
    expect(findTrigger("core", "webhook")?.strategy).toBe("webhook");
  });

  test("returns nothing for what is not, rather than throwing", () => {
    expect(findKit("myspace")).toBeUndefined();
    expect(findAction("gmail", "sendCarrierPigeon")).toBeUndefined();
    expect(findTrigger("core", "telepathy")).toBeUndefined();
    // An action name is not a trigger name, even within the same kit.
    expect(findTrigger("gmail", "sendEmail")).toBeUndefined();
  });
});

describe("the catalogue built from the registry", () => {
  test("covers every kit, so nothing is invisible to the builder", () => {
    const catalogue = toKitCatalogue(kits, { availableConnectorIds: [] });

    expect(catalogue.map((entry) => entry.id).toSorted()).toEqual(kits.map((kit) => kit.id).toSorted());
  });

  /**
   * Polling and cron are defined but nothing fires them yet. The builder needs to know that from the
   * catalogue, or it will accept a flow that never runs.
   */
  test("reports which triggers this deployment can actually fire", () => {
    const catalogue = toKitCatalogue(kits, { availableConnectorIds: ["google"] });
    const byStrategy = catalogue.flatMap((entry) => entry.triggers).map((trigger) => trigger);

    for (const trigger of byStrategy) {
      const expected: readonly string[] = config.kits.schedulableTriggerStrategies;

      expect(trigger.schedulable).toBe(expected.includes(trigger.strategy));
    }
  });

  test("core and http are available with no connector configured; gmail is not", () => {
    const catalogue = toKitCatalogue(kits, { availableConnectorIds: [] });
    const availability = new Map(catalogue.map((entry) => [entry.id, entry.available]));

    expect(availability.get("core")).toBe(true);
    expect(availability.get("http")).toBe(true);
    expect(availability.get("gmail")).toBe(false);
  });
});
