/**
 * `core` — the kit that needs no service.
 *
 * Everything here is either a way to start a flow that involves no third party, or a step that acts on
 * the flow itself rather than on anything outside it. It declares no auth, so it is always available.
 */

import { createKit } from "@automend/kit-framework";
import { coreDelayAction } from "./actions/delay";
import { coreLogAction } from "./actions/log";
import { coreManualTrigger } from "./triggers/manual";
import { coreScheduleTrigger } from "./triggers/schedule";
import { coreWebhookTrigger } from "./triggers/webhook";

export const coreKit = createKit({
  id: "core",
  displayName: "Core",
  description: "Ways to start a flow, and steps that act on the flow itself.",
  actions: [coreDelayAction, coreLogAction],
  triggers: [coreManualTrigger, coreWebhookTrigger, coreScheduleTrigger],
});
