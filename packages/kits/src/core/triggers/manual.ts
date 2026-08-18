import { createTrigger } from "@automend/kit-framework";

/**
 * Started by a person pressing Run.
 *
 * The payload is whatever the caller supplied, which makes this the trigger to build a flow against
 * before its real trigger is wired up: post the shape you expect, watch the steps run.
 */
export const coreManualTrigger = createTrigger({
  name: "manual",
  displayName: "Run manually",
  description: "Start this flow by hand, optionally with some data.",
  strategy: "manual",
  props: {},
  sampleData: {},
});
