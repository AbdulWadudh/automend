import { createAction, Property, requireOAuthToken } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { assertSlackOk, bearer, parseSlack, postedMessageSchema, slackUrls } from "../common/api";

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
    channel: Property.shortText({
      displayName: "Channel",
      description: "A channel id like C0123ABCDEF, or a name like #general. Supports variables.",
      required: true,
      maxLength: validation.slackChannel.maxLength,
    }),
    text: Property.longText({
      displayName: "Message",
      description: "Slack's mrkdwn is supported. Also the fallback shown in notifications.",
      required: true,
      maxLength: validation.slackMessage.maxLength,
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
    const { channel, text, threadTs, replyBroadcast } = context.input;

    const response = await context.http.request({
      method: "POST",
      url: slackUrls.postMessage,
      headers: { ...bearer(accessToken), "content-type": "application/json; charset=utf-8" },
      body: {
        channel,
        text,
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
