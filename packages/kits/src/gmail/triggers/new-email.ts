import {
  createTrigger,
  initialiseDedupe,
  type Poll,
  Property,
  pollWithDedupe,
  requireOAuthToken,
} from "@automend/kit-framework";
import { config } from "@automend/shared";
import {
  assertOk,
  bearer,
  type GmailFetcher,
  gmailUrls,
  messageDetailSchema,
  messageListSchema,
  parseGmail,
} from "../common/api";
import { findHeader } from "../common/mime";

/**
 * Runs when mail arrives.
 *
 * Polling rather than push, because Gmail's watch API needs a Cloud Pub/Sub topic — infrastructure a
 * self-hosted deployment should not be obliged to run.
 *
 * `lastItem` deduplication rather than timestamp: Gmail's listing is ordered newest-first and stable,
 * whereas `internalDate` is when Gmail received the message, which is not monotonic across the delays
 * a mail server introduces — two messages can arrive out of order and a timestamp cursor would skip
 * the later-dated one.
 *
 * Defined but not yet fired: nothing schedules polling triggers until the scheduler lands, and the
 * catalogue reports that rather than letting an author build a flow that silently never runs.
 */
export const gmailNewEmailTrigger = createTrigger({
  name: "newEmail",
  displayName: "New email",
  description: "Start this flow when a message matching a search arrives.",
  strategy: "polling",
  props: {
    query: Property.shortText({
      displayName: "Search",
      description: "Gmail search syntax, for example is:unread from:billing@example.com.",
      defaultValue: "is:unread",
      // A search, evaluated against the mailbox before any run exists to draw variables from.
      templatable: false,
    }),
  },
  sampleData: {
    id: "18f0a1b2c3d4e5f6",
    threadId: "18f0a1b2c3d4e5f6",
    from: "Ada Lovelace <ada@example.com>",
    to: "orders@example.com",
    subject: "Invoice 1024",
    snippet: "Attached is the invoice for August.",
    receivedAt: "2026-08-19T09:14:02.000Z",
    labelIds: ["INBOX", "UNREAD"],
  },
  onEnable: async (context) => {
    // Without this, switching the trigger on would treat every message already in the mailbox as new
    // and start a run for each one.
    await initialiseDedupe(buildPoll(context), context.store, Date.now());
  },
  produce: async (context) => {
    const stubs = await pollWithDedupe(buildPoll(context), context.store);
    const fetcher: GmailFetcher = { http: context.http, accessToken: requireOAuthToken(context) };

    // Details are fetched only for what turned out to be new. Fetching every listed message on every
    // poll would be one call per message in the mailbox, every few minutes, forever.
    return await Promise.all(stubs.map((stub) => fetchMessage(fetcher, readStubId(stub))));
  },
});

type ListContext = Parameters<typeof gmailNewEmailTrigger.produce>[0] & {
  input: { query?: string };
};

/**
 * The listing half of the poll, shared by `onEnable` and `produce` so the two cannot disagree about
 * which messages exist — a mismatch there is how a trigger ends up either replaying an inbox or
 * silently skipping its first message.
 */
function buildPoll(context: ListContext): Poll {
  return {
    strategy: "lastItem",
    fetch: async () => {
      const accessToken = requireOAuthToken(context);
      const query = context.input.query;

      const response = await context.http.request({
        method: "GET",
        url: gmailUrls.listMessages,
        headers: bearer(accessToken),
        query: {
          maxResults: config.kits.maxPollItems,
          ...(query ? { q: query } : {}),
        },
      });

      assertOk(response, "list messages");

      const listed = parseGmail(messageListSchema, response.body, "listing messages");

      // Newest first, which is the order `lastItem` deduplication expects.
      return (listed.messages ?? []).map((message) => ({ id: message.id, data: message }));
    },
  };
}

async function fetchMessage(fetcher: GmailFetcher, messageId: string) {
  const response = await fetcher.http.request({
    method: "GET",
    url: gmailUrls.message(messageId),
    headers: bearer(fetcher.accessToken),
    // Metadata and a snippet: enough for a flow to route on without copying every message body into
    // the run journal, where it would sit unencrypted for as long as the run is kept.
    query: { format: "metadata" },
  });

  assertOk(response, "read a message");

  const detail = parseGmail(messageDetailSchema, response.body, "reading a message");
  const headers = detail.payload?.headers ?? [];

  return {
    id: detail.id,
    threadId: detail.threadId,
    from: findHeader(headers, "from"),
    to: findHeader(headers, "to"),
    subject: findHeader(headers, "subject"),
    snippet: detail.snippet,
    receivedAt: toIsoDate(detail.internalDate),
    labelIds: detail.labelIds ?? [],
  };
}

/**
 * Gmail sends `internalDate` as a decimal string of epoch milliseconds, because the value is outside
 * what JSON numbers carry safely.
 *
 * An unparseable one becomes null rather than an Invalid Date — which would survive as far as a
 * template rendering the words "Invalid Date" into somebody's email.
 */
function toIsoDate(internalDate: string | undefined): string | null {
  if (internalDate === undefined) {
    return null;
  }

  const epochMs = Number(internalDate);

  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

/** `pollWithDedupe` returns its `data` values as `unknown`, so the id is re-established rather than cast. */
function readStubId(stub: unknown): string {
  if (stub !== null && typeof stub === "object" && "id" in stub && typeof stub.id === "string") {
    return stub.id;
  }

  throw new Error("A polled Gmail message had no id");
}
