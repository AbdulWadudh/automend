/**
 * `gmail` — the first kit that acts on somebody's behalf.
 *
 * It names the existing `google` connector rather than introducing credentials of its own: a workspace
 * authorises Google once, and every kit that needs it shares that connection. The `gmail.send` scope
 * is already requested there, which is what makes this kit usable rather than a promise the platform
 * cannot keep.
 */

import { createKit, kitOAuth, kitRateLimit } from "@automend/kit-framework";
import { gmailSendEmailAction } from "./actions/send-email";
import { gmailNewEmailTrigger } from "./triggers/new-email";

export const gmailKit = createKit({
  id: "gmail",
  displayName: "Gmail",
  description: "Send and watch mail through a connected Google account.",
  auth: kitOAuth({
    connectorId: "google",
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
  }),
  /**
   * Gmail allows 250 quota units per user per second, and `messages.send` costs 100 of them — so two
   * sends a second is what one connected account is actually granted, not a number chosen here.
   */
  limits: kitRateLimit({ requests: 2, perSeconds: 1 }),
  actions: [gmailSendEmailAction],
  triggers: [gmailNewEmailTrigger],
});
