/**
 * Slack's addresses and the shapes it answers with.
 *
 * The base URL lives here rather than in `config.ts` for the reason the Gmail kit gives: a
 * third-party API endpoint is not a configured value, and collecting every kit's upstream URLs in
 * the shared config would couple the platform's configuration to its catalogue.
 */

import type { HttpResponse } from "@automend/kit-framework";
import { stepExecutionError } from "@automend/shared";
import { z } from "zod";

const BASE_URL = "https://slack.com/api";

export const slackUrls = {
  postMessage: `${BASE_URL}/chat.postMessage`,
  listConversations: `${BASE_URL}/conversations.list`,
} as const;

export function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, accept: "application/json" };
}

const errorSchema = z.object({ error: z.string() });

/**
 * Slack reports a refusal as `200 {"ok":false,"error":"..."}`, so a status check alone would let a
 * step that posted nothing report success. The status is checked too, because a 429 or a 5xx never
 * reaches the `ok` field at all.
 */
export function assertSlackOk(response: HttpResponse, what: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw stepExecutionError(`Slack refused to ${what} (HTTP ${response.status})`);
  }

  const body = response.body;

  if (typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
    return;
  }

  const detail = errorSchema.safeParse(body);
  // `not_in_channel` and `missing_scope` are the two an author will actually hit, and both are
  // fixed by doing something in Slack rather than in the flow — so the code is quoted verbatim.
  const because = detail.success ? ` — ${detail.data.error}` : "";

  throw stepExecutionError(`Slack refused to ${what}${because}`);
}

/** Parses a Slack response, naming the call so a schema change is traceable to one place. */
export function parseSlack<Schema extends z.ZodType>(schema: Schema, body: unknown, what: string): z.infer<Schema> {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw stepExecutionError(`Slack's response to ${what} was not the shape this step expects`);
  }

  return result.data;
}

export const conversationListSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      is_private: z.boolean().optional(),
    }),
  ),
  /** Slack sends an empty string, not an absent field, on the last page. */
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

export const postedMessageSchema = z.object({
  channel: z.string(),
  /** Slack's message id, and the value a later reply passes back as `thread_ts`. */
  ts: z.string(),
});
