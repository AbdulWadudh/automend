/**
 * `createTrigger` — one way a flow can start.
 *
 * Four strategies, and the difference between them is only *who notices* that something happened:
 *
 * | Strategy  | Noticed by                                    |
 * |-----------|-----------------------------------------------|
 * | `manual`  | a person pressing Run                         |
 * | `webhook` | the service calling the flow's URL            |
 * | `polling` | us asking the service on an interval          |
 * | `cron`    | the clock, with no service involved           |
 *
 * All four converge on the same question — what payloads did this firing produce? — which is why
 * they share one `produce` hook rather than having a hook each. A trigger that produces an empty
 * array fired but found nothing, and no run is started.
 *
 * Type erasure works the same way as in `action.ts`: generics in the signature, uniform value out.
 */

import { config } from "@automend/shared";
import type { KitInvocation } from "./context";
import type { InputPropertyMap, ResolvedInput } from "./property";

export type TriggerStrategy = (typeof config.kits.triggerStrategies)[number];

/** Whether this deployment can currently fire a strategy — see `config.kits`. */
export function isSchedulable(strategy: TriggerStrategy): boolean {
  const schedulable: readonly string[] = config.kits.schedulableTriggerStrategies;

  return schedulable.includes(strategy);
}

/**
 * What arrived, if anything did.
 *
 * A webhook trigger receives the request; a manual trigger receives whatever the caller supplied; a
 * cron or polling trigger receives nothing and goes and looks instead.
 */
export type TriggerInvocation<Props extends InputPropertyMap = InputPropertyMap> = Omit<KitInvocation, "input"> & {
  readonly input: ResolvedInput<Props>;
  readonly payload: unknown;
};

export type CreateTriggerSpec<Props extends InputPropertyMap> = {
  name: string;
  displayName: string;
  description: string;
  strategy: TriggerStrategy;
  props: Props;
  /**
   * A representative payload, shown in the variable picker so an author can wire up the steps
   * *before* the flow has ever run. Without it the second step of a new flow has nothing to refer to.
   */
  sampleData: unknown;
  /** Registering with the service — subscribing a webhook, seeding a polling cursor. */
  onEnable?: (context: TriggerInvocation<Props>) => Promise<void>;
  onDisable?: (context: TriggerInvocation<Props>) => Promise<void>;
  /** Defaults to passing the payload straight through, which is what a plain webhook wants. */
  produce?: (context: TriggerInvocation<Props>) => Promise<unknown[]>;
};

export type TriggerDefinition = {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly strategy: TriggerStrategy;
  readonly props: InputPropertyMap;
  readonly sampleData: unknown;
  readonly onEnable: (context: TriggerInvocation) => Promise<void>;
  readonly onDisable: (context: TriggerInvocation) => Promise<void>;
  readonly produce: (context: TriggerInvocation) => Promise<unknown[]>;
};

export function createTrigger<const Props extends InputPropertyMap>(spec: CreateTriggerSpec<Props>): TriggerDefinition {
  // Sound for the same reason as in `action.ts`: the engine validates the input against `spec.props`
  // before any of these hooks is called.
  const narrow = (context: TriggerInvocation): TriggerInvocation<Props> => context as TriggerInvocation<Props>;

  // Destructured so the presence checks below narrow the hooks; reading `spec.onEnable` inside a
  // closure would not.
  const { onEnable, onDisable, produce } = spec;

  const noop = async (): Promise<void> => {};
  const passThrough = async (context: TriggerInvocation): Promise<unknown[]> => [context.payload];

  return {
    name: spec.name,
    displayName: spec.displayName,
    description: spec.description,
    strategy: spec.strategy,
    props: spec.props,
    sampleData: spec.sampleData,
    onEnable: onEnable ? (context: TriggerInvocation) => onEnable(narrow(context)) : noop,
    onDisable: onDisable ? (context: TriggerInvocation) => onDisable(narrow(context)) : noop,
    produce: produce ? (context: TriggerInvocation) => produce(narrow(context)) : passThrough,
  };
}
