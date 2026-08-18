/**
 * `createAction` — one thing a kit can do.
 *
 * The returned definition is *not* generic, and that is deliberate. The registry, the catalogue and
 * the engine all handle actions from every kit in one list, which they could not do if each action's
 * type carried its own property map. So the generics live only in this function's signature, where
 * they type the author's `run`, and the value it produces is uniform.
 */

import type { ActionContext, KitInvocation } from "./context";
import type { InputPropertyMap, ResolvedInput } from "./property";

export type ActionRunner<Props extends InputPropertyMap> = (context: ActionContext<Props>) => Promise<unknown>;

export type CreateActionSpec<Props extends InputPropertyMap> = {
  /** camelCase, unique within the kit. Stored in every flow that uses it, so it is an identifier. */
  name: string;
  displayName: string;
  /** One sentence, shown in the step picker. What it does, in the author's terms. */
  description: string;
  props: Props;
  run: ActionRunner<Props>;
};

export type ActionDefinition = {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly props: InputPropertyMap;
  /** Called by the engine with input already resolved, coerced and validated against `props`. */
  readonly invoke: (context: KitInvocation) => Promise<unknown>;
};

export function createAction<const Props extends InputPropertyMap>(spec: CreateActionSpec<Props>): ActionDefinition {
  return {
    name: spec.name,
    displayName: spec.displayName,
    description: spec.description,
    props: spec.props,
    invoke: (context: KitInvocation) =>
      // The one cast in the framework, and it is sound by construction: the engine validates
      // `context.input` against this action's own `props` with `buildResolvedInputSchema` before
      // calling, so the record really does have the shape `ResolvedInput<Props>` describes. Erasing
      // it here is what keeps every action assignable to one non-generic type.
      spec.run({ ...context, input: context.input as ResolvedInput<Props> }),
  };
}
