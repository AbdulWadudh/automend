/**
 * What a kit is handed when it runs, and — more importantly — what it is not.
 *
 * There is no database client here, no filesystem, no `fetch` and no master key. A kit gets the
 * inputs for its own step, one credential, a guarded HTTP client, a dedupe store and a logger. That
 * list is the sandbox's contract: the engine subprocess cannot offer a kit anything else, so a kit
 * with a bug or a malicious dependency reaches no further than the run it is part of.
 */

import { stepExecutionError } from "@automend/shared";
import type { KitCredential } from "./credential";
import type { HttpClient, KitLogger } from "./http";
import type { InputPropertyMap, ResolvedInput } from "./property";
import type { KitStore } from "./store";

export type { KitCredential };

export type RunContext = {
  readonly id: string;
  readonly flowId: string;
  readonly tenantId: string;
  /** Stable across retries of this run, for a kit that can pass one to the service it calls. */
  readonly idempotencyKey: string;
};

export type StepContext = {
  /** The name the flow's author gave this step, for error messages that mean something to them. */
  readonly name: string;
};

/**
 * The context with its input type erased, which is what the engine and the registry pass around.
 *
 * Kits never see this shape — `createAction` narrows `input` to the action's own property map before
 * the author's code runs.
 */
export type KitInvocation = {
  readonly input: Record<string, unknown>;
  readonly auth: KitCredential | undefined;
  readonly http: HttpClient;
  readonly store: KitStore;
  readonly run: RunContext;
  readonly step: StepContext;
  readonly logger: KitLogger;
};

export type ActionContext<Props extends InputPropertyMap> = Omit<KitInvocation, "input"> & {
  readonly input: ResolvedInput<Props>;
};

/**
 * The credential, insisted upon.
 *
 * A kit declares the auth it needs and the engine refuses to run a step whose connection is missing,
 * so reaching either of these with nothing is a bug rather than a user error — but a kit reading
 * `ctx.auth?.accessToken` and quietly sending `undefined` upstream is worse than a clear failure.
 */
export function requireOAuthToken(context: Pick<KitInvocation, "auth" | "step">): string {
  if (context.auth?.kind !== "oauth") {
    throw stepExecutionError(`"${context.step.name}" needs an OAuth connection before it can run`);
  }

  return context.auth.accessToken;
}

export function requireToken(context: Pick<KitInvocation, "auth" | "step">): string {
  if (context.auth?.kind !== "token") {
    throw stepExecutionError(`"${context.step.name}" needs an API token connection before it can run`);
  }

  return context.auth.token;
}
