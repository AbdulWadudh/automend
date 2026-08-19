/**
 * The channels a step may post to, for the builder's picker.
 *
 * Paginated deliberately rather than taking Slack's first page: a workspace's channels are not
 * alphabetical across pages, so stopping after one would hide channels arbitrarily rather than
 * showing the first hundred by any order a person could predict.
 */

import type { LoadOptionsContext } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { assertSlackOk, bearer, conversationListSchema, parseSlack, slackUrls } from "./api";

/** Slack's own ceiling for this method. */
const PAGE_SIZE = 200;

export async function loadChannelOptions(context: LoadOptionsContext) {
  const accessToken = context.auth?.kind === "oauth" ? context.auth.accessToken : undefined;

  if (!accessToken) {
    // The api refuses to load options for a step with no connection, so this is a bug rather than a
    // user error — but returning an empty list would read as "this workspace has no channels".
    throw new Error("Listing channels needs a connected Slack workspace");
  }

  const options: { label: string; value: string; description?: string }[] = [];
  let cursor: string | undefined;

  do {
    const response = await context.http.request({
      method: "GET",
      url: slackUrls.listConversations,
      headers: bearer(accessToken),
      query: {
        // Both kinds the bot can see. A private channel it was never invited to is absent from
        // Slack's answer regardless, so asking for them cannot over-report what a step could reach.
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    });

    assertSlackOk(response, "list the channels");

    const page = parseSlack(conversationListSchema, response.body, "listing channels");

    for (const channel of page.channels) {
      options.push({
        label: channel.name ? `#${channel.name}` : channel.id,
        value: channel.id,
        description: channel.is_private ? "private" : undefined,
      });
    }

    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor && options.length < config.kits.maxDynamicOptions);

  return options.toSorted((left, right) => left.label.localeCompare(right.label));
}
