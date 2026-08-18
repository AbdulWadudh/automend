import { createAction, Property } from "@automend/kit-framework";

/**
 * Writes a line to the run's journal.
 *
 * The step people reach for first, and the one that makes a flow debuggable: pointing it at
 * `{{trigger.body.orderId}}` is how an author finds out what their webhook actually sends.
 */
export const coreLogAction = createAction({
  name: "log",
  displayName: "Write to log",
  description: "Record a line in the run log, with variables substituted.",
  props: {
    message: Property.longText({
      displayName: "Message",
      description: "Supports variables, so this is the quickest way to see what a step received.",
      required: true,
      defaultValue: "Step reached",
    }),
  },
  run: async (context) => {
    context.logger.info(context.input.message);

    return { message: context.input.message };
  },
});
