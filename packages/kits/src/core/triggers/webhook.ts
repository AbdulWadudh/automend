import { createTrigger, Property } from "@automend/kit-framework";
import { config } from "@automend/shared";

/**
 * Started by somebody else's server calling this flow's URL.
 *
 * The payload mirrors the delivery as it was recorded — method, path, query, headers, body — rather
 * than the body alone, because a sender's own headers are often the interesting part and a body is
 * not always JSON. `body` is the parsed value when the request declared JSON and the raw text when
 * it did not, so a template can reach into one without the other becoming unreadable.
 */
export const coreWebhookTrigger = createTrigger({
  name: "webhook",
  displayName: "Incoming webhook",
  description: "Start this flow when a request arrives at its URL.",
  strategy: "webhook",
  props: {
    path: Property.shortText({
      displayName: "Path",
      description: "Appended to this flow's webhook address. Letters, numbers and dashes.",
      required: true,
      defaultValue: "incoming",
      // A route, not a value: it is read to *match* an incoming request, long before there is any run
      // data to substitute, so offering a variable picker here would promise something impossible.
      templatable: false,
      maxLength: config.validation.webhookPath.maxLength,
    }),
  },
  sampleData: {
    method: "POST",
    path: "incoming",
    query: null,
    headers: { "content-type": "application/json" },
    body: { orderId: "A-1024", customer: { email: "ada@example.com", name: "Ada" }, total: 42.5 },
  },
});
