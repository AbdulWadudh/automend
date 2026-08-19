import { createAction, Property, requireOAuthToken } from "@automend/kit-framework";
import { config } from "@automend/shared";
import { assertOk, bearer, gmailUrls, parseGmail, sentMessageSchema } from "../common/api";
import { buildRawMessage } from "../common/mime";

const { validation } = config;

/**
 * Sends mail from the connected mailbox.
 *
 * The first action in the platform with a side effect that cannot be undone, which is why the run's
 * idempotency key matters: a retried job must find this step already recorded in the journal and
 * replay its stored result rather than sending a second copy. The engine enforces that; this action
 * only has to be honest about whether it succeeded.
 */
export const gmailSendEmailAction = createAction({
  name: "sendEmail",
  displayName: "Send email",
  description: "Send a message from the connected Gmail account.",
  props: {
    to: Property.shortText({
      displayName: "To",
      description: "One address, or several separated by commas. Supports variables.",
      required: true,
      maxLength: validation.emailRecipients.maxLength,
    }),
    cc: Property.shortText({ displayName: "Cc", maxLength: validation.emailRecipients.maxLength }),
    bcc: Property.shortText({ displayName: "Bcc", maxLength: validation.emailRecipients.maxLength }),
    subject: Property.shortText({
      displayName: "Subject",
      required: true,
      maxLength: validation.emailSubject.maxLength,
    }),
    body: Property.longText({
      displayName: "Body",
      required: true,
      // The one field in the catalogue that is genuinely markup: `bodyType` below sends it as HTML,
      // and `toEmailSafeHtml` inlines the editor's classes on the way out.
      rich: true,
      maxLength: validation.emailBody.maxLength,
    }),
    bodyType: Property.staticDropdown({
      displayName: "Body format",
      required: true,
      defaultValue: "text",
      options: [
        { label: "Plain text", value: "text" },
        { label: "HTML", value: "html" },
      ],
    }),
  },
  run: async (context) => {
    const accessToken = requireOAuthToken(context);
    const { to, cc, bcc, subject, body, bodyType } = context.input;

    const raw = buildRawMessage({ to, cc, bcc, subject, body, bodyType });

    const response = await context.http.request({
      method: "POST",
      url: gmailUrls.sendMessage,
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: { raw },
    });

    assertOk(response, "send the message");

    const sent = parseGmail(sentMessageSchema, response.body, "sending a message");

    // Deliberately not echoing the body back: a step's output is written to the run journal, and a
    // journal is not the place to keep a second copy of everything anyone has ever emailed.
    return { messageId: sent.id, threadId: sent.threadId, to, subject };
  },
});
