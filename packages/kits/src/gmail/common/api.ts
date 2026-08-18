/**
 * Gmail's addresses and the shapes it answers with.
 *
 * The base URL lives here rather than in `config.ts` deliberately. A third-party API endpoint is not a
 * configured value — nobody deploys Automend against a different Gmail — and putting every kit's
 * upstream URLs in the shared config would couple the platform's configuration to its catalogue and
 * grow it without bound. It is written once here and every path is derived from it, which is the same
 * discipline applied locally.
 */

import type { HttpClient, HttpResponse } from "@automend/kit-framework";
import { stepExecutionError } from "@automend/shared";
import { z } from "zod";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const SELF = "users/me";

export const gmailUrls = {
  sendMessage: `${BASE_URL}/${SELF}/messages/send`,
  listMessages: `${BASE_URL}/${SELF}/messages`,
  message: (messageId: string) => `${BASE_URL}/${SELF}/messages/${encodeURIComponent(messageId)}`,
} as const;

export function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, accept: "application/json" };
}

/**
 * Turns an error status into a step failure that says what happened.
 *
 * The guarded client returns a failing status rather than throwing, because reporting one is the whole
 * job of `http.request`. A kit acting on a service is the opposite case: a 403 from Gmail means the
 * step did not do what the flow asked, so continuing would be a lie. Gmail's own message is included
 * because "insufficient authentication scopes" is the difference between a bug and a reconnect.
 */
export function assertOk(response: HttpResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const detail = gmailErrorSchema.safeParse(response.body);
  const because = detail.success ? ` — ${detail.data.error.message}` : "";

  throw stepExecutionError(`Gmail refused to ${what} (HTTP ${response.status})${because}`);
}

const gmailErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});

/**
 * Gmail's responses are parsed rather than trusted.
 *
 * They arrive over the network into a subprocess that runs kit code, so they are untrusted input like
 * any request body — and these schemas are loose on purpose: `catchall`-style optionality means a field
 * Google adds or omits does not fail a run that never needed it.
 */
export const messageStubSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

export const messageListSchema = z.object({
  /** Absent rather than empty when a query matches nothing, which is Google's convention. */
  messages: z.array(messageStubSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const messageHeaderSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
});

export const messageDetailSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  /** Milliseconds since the epoch, as a string. Google sends numbers over 2^53 as text. */
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z.array(messageHeaderSchema).optional(),
    })
    .optional(),
});

export const sentMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

/** Parses a Gmail response, naming the call so a schema change is traceable to one place. */
export function parseGmail<Schema extends z.ZodType>(schema: Schema, body: unknown, what: string): z.infer<Schema> {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw stepExecutionError(`Gmail's response to ${what} was not the shape this step expects`);
  }

  return result.data;
}

export type GmailFetcher = {
  http: HttpClient;
  accessToken: string;
};
