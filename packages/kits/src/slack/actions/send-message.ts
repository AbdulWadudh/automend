import { createAction, Property, requireOAuthToken } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { assertSlackOk, bearer, parseSlack, postedMessageSchema, slackUrls } from "../common/api";
import { parseSlackBlocks } from "../common/blocks";
import { loadChannelOptions } from "../common/channels";

const { validation } = config;

/**
 * Posts a message as the app.
 *
 * A side effect nobody can undo, like sending mail: a retried job must find this step in the run
 * journal and replay its result rather than posting a second copy. The engine enforces that; this
 * action only has to be honest about whether it succeeded.
 */
export const slackSendMessageAction = createAction({
  name: "sendMessage",
  displayName: "Send message",
  description: "Post a message to a channel in the connected Slack workspace.",
  props: {
    channel: Property.dynamicDropdown({
      displayName: "Channel",
      description: "Channels this workspace's Automend app can see. Invite it to a private channel to list it.",
      required: true,
      loadOptions: loadChannelOptions,
      maxLength: validation.slackChannel.maxLength,
    }),
    text: Property.longText({
      displayName: "Message",
      description:
        "Slack mrkdwn: *bold*, _italic_, ~strike~, `code`, <https://example.com|a link>, <@U0123ABCD> and <#C0123ABCD>. With blocks below, this is what notifications and screen readers show.",
      required: true,
      maxLength: validation.slackMessage.maxLength,
    }),
    blocks: Property.json({
      displayName: "Blocks",
      description:
        'Optional Block Kit layout. Paste straight from Slack\'s Block Kit Builder — the array or the whole {"blocks": [...]} object. Supports variables.',
      maxLength: validation.slackBlocks.maxLength,
    }),
    threadTs: Property.shortText({
      displayName: "Reply to",
      description: "The `ts` of a message to reply to, which puts this one in that thread.",
      maxLength: validation.slackTimestamp.maxLength,
    }),
    replyBroadcast: Property.checkbox({
      displayName: "Also send the reply to the channel",
      defaultValue: false,
    }),
  },
  run: async (context) => {
    const accessToken = requireOAuthToken(context);
    const { channel, text, blocks, threadTs, replyBroadcast } = context.input;
    const layout = parseSlackBlocks(blocks);

    const response = await context.http.request({
      method: "POST",
      url: slackUrls.postMessage,
      headers: { ...bearer(accessToken), "content-type": "application/json; charset=utf-8" },
      body: {
        channel,
        // Sent alongside `blocks`, never instead of it: Slack shows this in notifications and in
        // clients that cannot render the layout, so dropping it makes a message that pings people
        // with nothing readable in the ping.
        text,
        ...(layout ? { blocks: layout } : {}),
        ...(threadTs ? { thread_ts: threadTs, reply_broadcast: replyBroadcast } : {}),
      },
    });

    assertSlackOk(response, "post the message");

    const posted = parseSlack(postedMessageSchema, response.body, "posting a message");

    // The text is not echoed back: a step's output goes to the run journal, which is not the place
    // to keep a second copy of everything anyone has ever posted.
    return { channel: posted.channel, ts: posted.ts, threadTs: threadTs ?? posted.ts };
  },
});
