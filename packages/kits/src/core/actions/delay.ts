import { createAction, Property } from "@automend/kit-framework";
import { config } from "@automend/shared";

const { delay } = config.flows;

/**
 * Waits before the next step runs.
 *
 * This genuinely blocks: suspending a run and resuming it later does not exist yet, so the wait
 * occupies a worker slot for its whole duration. That is why the maximum is derived from the engine's
 * step timeout rather than chosen — a longer wait would be killed mid-wait — and why this is a tool
 * for pacing a rate limit or letting an upstream settle, not for scheduling.
 */
export const coreDelayAction = createAction({
  name: "delay",
  displayName: "Wait",
  description: "Pause before the next step.",
  props: {
    durationMs: Property.number({
      displayName: "Wait for (ms)",
      description: `Up to ${delay.maxMs} ms. Longer waits belong in a schedule trigger.`,
      required: true,
      defaultValue: delay.defaultMs,
      minimum: delay.minMs,
      maximum: delay.maxMs,
    }),
  },
  run: async (context) => {
    const durationMs = context.input.durationMs;

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    return { waitedMs: durationMs };
  },
});
