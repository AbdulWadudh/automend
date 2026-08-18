import { createAction, Property } from "@automend/kit-framework";
import { config } from "@automend/shared";

const methodOptions = config.flows.httpMethods.map((method) => ({ label: method, value: method }));

/**
 * Calls a URL and hands the response to the next step.
 *
 * A failing status is *returned*, not thrown: reporting what a URL answered is the whole job, and a
 * 404 from a lookup is often the answer the flow wants. A step that should stop on an error status
 * says so through the step's own error handling, which is the author's decision rather than this
 * action's.
 *
 * The address rules, the timeout and the response size cap are the engine's, not this action's —
 * every kit reaches the network through the same guarded client, so there is one place to get them
 * right.
 */
export const httpRequestAction = createAction({
  name: "request",
  displayName: "HTTP request",
  description: "Call a URL and continue with its response.",
  props: {
    method: Property.staticDropdown({
      displayName: "Method",
      required: true,
      defaultValue: config.flows.defaultHttpMethod,
      options: methodOptions,
    }),
    url: Property.shortText({
      displayName: "URL",
      required: true,
      maxLength: config.validation.stepUrl.maxLength,
    }),
    headers: Property.json({
      displayName: "Headers",
      description: 'A JSON object, for example {"authorization": "Bearer …"}.',
    }),
    body: Property.longText({
      displayName: "Body",
      description: "Sent as-is. Set a content-type header to match what you are sending.",
    }),
  },
  run: async (context) => {
    const { method, url, headers, body } = context.input;

    const response = await context.http.request({
      method,
      url,
      headers: toHeaderRecord(headers),
      rawBody: body,
    });

    return { status: response.status, headers: response.headers, body: response.body };
  },
});

/**
 * A `json` property resolves to `unknown`, so the object shape has to be established rather than
 * assumed — an author may type an array or a number into the field.
 *
 * Non-string values are stringified rather than rejected, because `{"x-retry": 3}` is a reasonable
 * thing to write and refusing it would be pedantry.
 */
function toHeaderRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const headers: Record<string, string> = {};

  for (const [name, headerValue] of Object.entries(value)) {
    if (headerValue !== null && headerValue !== undefined) {
      headers[name] = String(headerValue);
    }
  }

  return headers;
}
