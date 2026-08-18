import { describe, expect, test } from "bun:test";
import { createAction } from "../src/action";
import { kitCatalogueSchema, toKitCatalogue } from "../src/catalogue";
import { createKit, kitOAuth } from "../src/kit";
import { Property } from "../src/property";
import { createTrigger } from "../src/trigger";

/**
 * The catalogue is the contract between the registry and the builder: kit *metadata* crosses to the
 * browser, kit *code* never does. So the shape it produces has to parse against the schema the web app
 * uses, which is what the round-trip below is checking.
 */

const gmail = createKit({
  id: "gmail",
  displayName: "Gmail",
  description: "Email by Google",
  auth: kitOAuth({ connectorId: "google", scopes: ["https://www.googleapis.com/auth/gmail.send"] }),
  actions: [
    createAction({
      name: "sendEmail",
      displayName: "Send email",
      description: "Sends a message",
      props: {
        to: Property.shortText({ displayName: "To", required: true }),
        subject: Property.shortText({ displayName: "Subject" }),
        body: Property.longText({ displayName: "Body", description: "Supports variables" }),
      },
      run: async () => undefined,
    }),
  ],
  triggers: [
    createTrigger({
      name: "newEmail",
      displayName: "New email",
      description: "Runs when mail arrives",
      strategy: "polling",
      props: {
        label: Property.staticDropdown({ displayName: "Label", options: [{ label: "Inbox", value: "INBOX" }] }),
      },
      sampleData: { from: "ada@example.com" },
    }),
  ],
});

const core = createKit({ id: "core", displayName: "Core", description: "Built in" });

describe("the catalogue the builder receives", () => {
  const catalogue = toKitCatalogue([gmail, core], { availableConnectorIds: ["google"] });

  test("parses against the schema the web app uses", () => {
    expect(kitCatalogueSchema.safeParse(catalogue).success).toBe(true);
  });

  test("carries no kit code, only its description", () => {
    const serialised = JSON.stringify(catalogue);

    expect(serialised).not.toContain("function");
    expect(JSON.parse(serialised)).toEqual(catalogue);
  });

  test("properties keep the order the kit declared them in", () => {
    const names = catalogue[0]?.actions[0]?.properties.map((property) => property.name);

    expect(names).toEqual(["to", "subject", "body"]);
  });

  test("a dropdown's options come across, so the builder can render a real list", () => {
    expect(catalogue[0]?.triggers[0]?.properties[0]?.options).toEqual([{ label: "Inbox", value: "INBOX" }]);
  });

  test("the sample data comes across, so variables can be wired before the first run", () => {
    expect(catalogue[0]?.triggers[0]?.sampleData).toEqual({ from: "ada@example.com" });
  });
});

describe("what a deployment can actually offer", () => {
  test("a kit is unavailable when its connector has no credentials configured", () => {
    const [gmailEntry, coreEntry] = toKitCatalogue([gmail, core], { availableConnectorIds: [] });

    expect(gmailEntry?.available).toBe(false);
    // Listed rather than hidden, so an operator can see what they could turn on.
    expect(gmailEntry?.auth?.connectorId).toBe("google");
    // A kit needing no credentials is always available.
    expect(coreEntry?.available).toBe(true);
  });

  /**
   * A polling trigger is defined but nothing schedules it yet, so it is reported unschedulable and the
   * builder refuses it with a reason — rather than accepting a flow that would silently never run.
   */
  test("a trigger this deployment cannot fire says so", () => {
    const [gmailEntry] = toKitCatalogue([gmail], { availableConnectorIds: ["google"] });

    expect(gmailEntry?.triggers[0]?.strategy).toBe("polling");
    expect(gmailEntry?.triggers[0]?.schedulable).toBe(false);
  });
});
