/**
 * Every kit this deployment has, and the lookups the engine and the API resolve steps through.
 *
 * **Adding a service is two lines here plus a directory.** That is the whole point of the kit model, and
 * this file is where the promise is kept — nothing else in the platform needs to learn about a new
 * service, because the builder renders from the catalogue and the engine dispatches through
 * `findAction`.
 *
 * One package with a directory per service, rather than a package per service as Activepieces has: they
 * need npm packages because pieces are installed at runtime from a registry, and we have a fixed set in
 * a monorepo. Two hundred `package.json` files would buy nothing.
 */

import { type ActionDefinition, deepFreeze, type KitDefinition, type TriggerDefinition } from "@automend/kit-framework";
import { coreKit } from "./core";
import { gmailKit } from "./gmail";
import { httpKit } from "./http";
import { slackKit } from "./slack";

/**
 * The catalogue, frozen once at module load.
 *
 * Deep, not shallow: these are module-level singletons serving every run in a worker that may stay up
 * for weeks, and `Object.freeze` on a kit would leave its `actions` array and its properties' `options`
 * arrays mutable. A stray mutation would not fail near the bug — it would quietly change later runs.
 */
export const kits: readonly KitDefinition[] = deepFreeze([coreKit, httpKit, gmailKit, slackKit]);

/**
 * Two kits sharing an id would make `findKit` return whichever came first, so a step would silently
 * dispatch to the wrong service. Checked at import time, because there is no recovering from it later.
 */
function assertUniqueKitIds(): void {
  const seen = new Set<string>();

  for (const kit of kits) {
    if (seen.has(kit.id)) {
      throw new Error(`Two kits share the id "${kit.id}"`);
    }

    seen.add(kit.id);
  }
}

assertUniqueKitIds();

const byId = new Map(kits.map((kit) => [kit.id, kit]));

export function findKit(kitId: string): KitDefinition | undefined {
  return byId.get(kitId);
}

export function findAction(kitId: string, actionName: string): ActionDefinition | undefined {
  return findKit(kitId)?.actions.find((action) => action.name === actionName);
}

export function findTrigger(kitId: string, triggerName: string): TriggerDefinition | undefined {
  return findKit(kitId)?.triggers.find((trigger) => trigger.name === triggerName);
}

/**
 * `core.log`, for a message that has to name a step's kit and action together.
 *
 * One spelling of the pair, so an error, a log field and a test all read the same and none of them
 * invents a separator.
 */
export function describeStepKind(kitId: string, name: string): string {
  return `${kitId}.${name}`;
}
