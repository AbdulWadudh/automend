import { createTrigger, Property } from "@automend/kit-framework";
import { config } from "@automend/shared";

/**
 * Started by the clock, with no service involved.
 *
 * Defined but not yet fired: the catalogue reports `cron` as unschedulable until the scheduler exists,
 * so the builder offers this disabled with a reason rather than accepting a flow that would silently
 * never run.
 */
export const coreScheduleTrigger = createTrigger({
  name: "schedule",
  displayName: "On a schedule",
  description: "Start this flow at a recurring time.",
  strategy: "cron",
  props: {
    cron: Property.shortText({
      displayName: "Cron expression",
      description: "Five fields, in UTC. For example 0 9 * * 1 is every Monday at 09:00.",
      required: true,
      defaultValue: "0 9 * * *",
      // A schedule, read when the trigger is registered rather than when a run has data.
      templatable: false,
      maxLength: config.validation.cronExpression.maxLength,
    }),
  },
  // The clock brings no data with it, so the only thing a step can refer to is when it fired.
  sampleData: { firedAt: "2026-08-18T09:00:00.000Z" },
});
