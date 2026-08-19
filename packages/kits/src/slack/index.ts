/**
 * `slack` — the first kit that acts as an *app* rather than as a person.
 *
 * The `slack` connector holds a bot token from Slack's v2 install flow, so a step posts as the
 * workspace's Automend app and keeps working after whoever installed it leaves. That is the reason
 * the connector requests `chat:write` as a bot scope and treats its user scopes as identity only.
 */

import { createKit, kitOAuth, kitRateLimit } from "@automend/kit-framework";
import { slackSendMessageAction } from "./actions/send-message";

export const slackKit = createKit({
  id: "slack",
  displayName: "Slack",
  description: "Post messages to a connected Slack workspace.",
  auth: kitOAuth({
    connectorId: "slack",
    /**
     * The read scopes are the channel picker's, not an action's. Declared here anyway so
     * `tests/registry.test.ts` holds the connector to requesting them — a picker that fails with
     * `missing_scope` is as broken as a step that does.
     */
    scopes: ["chat:write", "chat:write.public", "channels:read", "groups:read"],
  }),
  /**
   * Slack asks apps to post no more than one message a second per channel, and bursts briefly. The
   * bucket is keyed by connection rather than by channel, so this is the conservative reading.
   */
  limits: kitRateLimit({ requests: 1, perSeconds: 1 }),
  actions: [slackSendMessageAction],
});
