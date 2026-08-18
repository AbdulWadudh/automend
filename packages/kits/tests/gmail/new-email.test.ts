import { describe, expect, test } from "bun:test";
import type { KitStore } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { gmailNewEmailTrigger } from "../../src/gmail/triggers/new-email";
import { createFakeContext, createFakeHttp, createMemoryStore, googleOAuth, ok } from "../support/fake-kit-context";

/**
 * The trigger's job is to answer "what is new" without either replaying the mailbox or skipping a message.
 * The deduplication itself is tested in the framework; these cover the parts specific to Gmail — that the
 * listing is asked for correctly, that only genuinely new messages have their details fetched, and that
 * Gmail's odd field encodings are handled.
 */

const listing = (ids: readonly string[]) => ok({ messages: ids.map((id) => ({ id, threadId: `t-${id}` })) });

function messageDetail(id: string, overrides: Record<string, unknown> = {}) {
  return ok({
    id,
    threadId: `t-${id}`,
    labelIds: ["INBOX", "UNREAD"],
    snippet: `snippet for ${id}`,
    internalDate: "1755594842000",
    payload: {
      headers: [
        { name: "From", value: "ada@example.com" },
        { name: "To", value: "orders@example.com" },
        { name: "Subject", value: `Subject ${id}` },
      ],
    },
    ...overrides,
  });
}

function context(responses: Parameters<typeof createFakeHttp>[0], store: KitStore, query = "is:unread") {
  const http = createFakeHttp(responses);

  return {
    http,
    invocation: { ...createFakeContext({ http, store, input: { query }, auth: googleOAuth }), payload: undefined },
  };
}

describe("asking Gmail what is there", () => {
  test("sends the search and caps the page at the poll limit", async () => {
    const store = createMemoryStore();
    const { http, invocation } = context([listing([])], store, "from:billing@example.com");

    await gmailNewEmailTrigger.onEnable(invocation);

    expect(http.calls[0]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(http.calls[0]?.query).toEqual({ maxResults: config.kits.maxPollItems, q: "from:billing@example.com" });
    expect(http.calls[0]?.headers?.authorization).toBe("Bearer test-access-token");
  });

  test("omits the search entirely when the step left it blank", async () => {
    const store = createMemoryStore();
    const { http, invocation } = context([listing([])], store, "");

    await gmailNewEmailTrigger.onEnable(invocation);

    expect(http.calls[0]?.query).toEqual({ maxResults: config.kits.maxPollItems });
  });

  test("an empty mailbox is a normal answer, not a missing field", async () => {
    const store = createMemoryStore();
    const { invocation } = context([ok({})], store);

    await gmailNewEmailTrigger.onEnable(invocation);

    expect(await gmailNewEmailTrigger.produce(invocation)).toEqual([]);
  });
});

describe("what counts as new", () => {
  test("enabling the trigger does not treat the existing mailbox as new", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing(["m3", "m2", "m1"])], store).invocation);

    const { http, invocation } = context([listing(["m3", "m2", "m1"])], store);

    expect(await gmailNewEmailTrigger.produce(invocation)).toEqual([]);
    // One listing call and no detail calls: nothing was new, so nothing was fetched.
    expect(http.calls).toHaveLength(1);
  });

  test("only the messages that arrived since are fetched, oldest first", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing(["m1"])], store).invocation);

    const { http, invocation } = context(
      [listing(["m3", "m2", "m1"]), messageDetail("m2"), messageDetail("m3")],
      store,
    );

    const produced = await gmailNewEmailTrigger.produce(invocation);

    expect(produced).toHaveLength(2);
    // The listing plus exactly two details — m1 was already seen and is not re-fetched.
    expect(http.calls).toHaveLength(3);
    expect(http.calls[1]?.url).toContain("/messages/m2");
    expect(http.calls[2]?.url).toContain("/messages/m3");
  });

  test("metadata only, so message bodies never reach the run journal", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { http, invocation } = context([listing(["m1"]), messageDetail("m1")], store);

    await gmailNewEmailTrigger.produce(invocation);

    expect(http.calls[1]?.query).toEqual({ format: "metadata" });
  });
});

describe("the payload a flow receives", () => {
  test("carries the headers a flow would route on", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { invocation } = context([listing(["m1"]), messageDetail("m1")], store);
    const [message] = await gmailNewEmailTrigger.produce(invocation);

    expect(message).toEqual({
      id: "m1",
      threadId: "t-m1",
      from: "ada@example.com",
      to: "orders@example.com",
      subject: "Subject m1",
      snippet: "snippet for m1",
      receivedAt: "2025-08-19T09:14:02.000Z",
      labelIds: ["INBOX", "UNREAD"],
    });
  });

  /** Gmail sends `internalDate` as a decimal string because the value is outside safe JSON number range. */
  test("the received time is converted from Gmail's string of epoch milliseconds", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { invocation } = context([listing(["m1"]), messageDetail("m1", { internalDate: "0" })], store);
    const [message] = await gmailNewEmailTrigger.produce(invocation);

    expect(message).toMatchObject({ receivedAt: "1970-01-01T00:00:00.000Z" });
  });

  /**
   * An Invalid Date would survive as far as a template rendering the words "Invalid Date" into somebody's
   * email, which is worse than an honest null.
   */
  test("an unusable received time becomes null rather than an Invalid Date", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { invocation } = context([listing(["m1"]), messageDetail("m1", { internalDate: "not-a-number" })], store);
    const [message] = await gmailNewEmailTrigger.produce(invocation);

    expect(message).toMatchObject({ receivedAt: null });
  });

  test("a message missing the headers a flow wanted reports them absent rather than failing", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { invocation } = context([listing(["m1"]), messageDetail("m1", { payload: {} })], store);
    const [message] = await gmailNewEmailTrigger.produce(invocation);

    expect(message).toMatchObject({ id: "m1", from: undefined, subject: undefined });
  });
});

describe("the trigger's own contract", () => {
  test("it polls, which this deployment cannot yet schedule", () => {
    expect(gmailNewEmailTrigger.strategy).toBe("polling");
  });

  test("its sample data matches the payload it actually produces", async () => {
    const store = createMemoryStore();

    await gmailNewEmailTrigger.onEnable(context([listing([])], store).invocation);

    const { invocation } = context([listing(["m1"]), messageDetail("m1")], store);
    const [message] = await gmailNewEmailTrigger.produce(invocation);

    // The keys are what a variable picker offers before the flow has ever run, so a mismatch means the
    // builder advertises variables that never arrive.
    expect(Object.keys(message as object).toSorted()).toEqual(
      Object.keys(gmailNewEmailTrigger.sampleData as object).toSorted(),
    );
  });
});
