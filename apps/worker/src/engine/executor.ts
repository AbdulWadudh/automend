/**
 * Walking a flow and journalling what happens.
 *
 * This runs in the *parent*, which is what keeps every database write on this side of the process boundary. For
 * each step it: claims the attempt, resolves the input, asks the subprocess to invoke the action, records the
 * result, and carries the output forward for the steps that refer to it.
 *
 * The three properties worth reading the code for:
 *
 * - **A retried job replays rather than repeats.** `claimStepRun` either grants the claim or reports that this
 *   exact attempt is already recorded — in which case the stored output is used and the action is *not* invoked.
 *   That is the only reason a third attempt at a flow does not send a third email.
 * - **A failure stops the run unless the author said otherwise.** Steps after a stopped one are journalled as
 *   `skipped`, not left absent: "these three did not run" is information, and a gap looks like data loss.
 * - **A step that cannot resolve its input never reaches the subprocess.** The failure is recorded with the
 *   reason, before anything has touched the outside world.
 */

import type { ClaimStepValues, Database, StepClaim } from "@automend/db";
import { claimStepRun, completeStepRun, findSucceededStepOutputs, recordSkippedStep } from "@automend/db";
import { findAction } from "@automend/kits";
import type { FlowDefinition, FlowStepNode, RunError } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import type { EngineCredential } from "./protocol";
import { buildResolutionContext, buildStepVariableKeys, resolveStepInput, withStepOutput } from "./resolve-input";
import type { RunContext, StepHost } from "./step-host";

export type ExecutionOutcome = {
  status: "succeeded" | "failed";
  error: RunError | null;
};

export type ExecuteFlowOptions = {
  db: Database;
  run: RunContext;
  definition: FlowDefinition;
  triggerPayload: unknown;
  /** 1 for the first try; higher for a retry, so the journal keeps both. */
  attempt: number;
  host: StepHost;
  /** Resolved by the caller, keyed by step id — the parent holds the secrets key, not the engine. */
  credentials: Map<string, EngineCredential>;
  logger: Logger;
};

/**
 * The order steps run in.
 *
 * A topological walk from the trigger, so a step never runs before something it depends on. Nodes the trigger
 * cannot reach are left out entirely rather than run at the end: a step nothing connects to is an unfinished
 * edit, and running it because it happens to exist would execute something the author never wired up.
 *
 * The definition's schema has already refused cycles, so this cannot loop — but it counts visits anyway, because
 * relying on a guarantee made in another module for termination is how an infinite loop gets in later.
 */
export function planExecutionOrder(definition: FlowDefinition): FlowStepNode[] {
  const stepsById = new Map(definition.steps.map((step) => [step.id, step]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const edge of definition.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const remaining = new Map(incoming);
  const queue: string[] = [definition.trigger.id];
  const ordered: FlowStepNode[] = [];
  const limit = definition.steps.length + 1;

  for (let visits = 0; queue.length > 0 && visits <= limit; visits += 1) {
    const currentId = queue.shift();

    if (currentId === undefined) {
      break;
    }

    const step = stepsById.get(currentId);

    if (step) {
      ordered.push(step);
    }

    for (const nextId of outgoing.get(currentId) ?? []) {
      const left = (remaining.get(nextId) ?? 1) - 1;

      remaining.set(nextId, left);

      // Queued only once everything feeding it has run, so a step after two branches waits for both.
      if (left <= 0) {
        queue.push(nextId);
      }
    }
  }

  return ordered;
}

function stepError(step: FlowStepNode, code: string, message: string): RunError {
  return { code, message, stepId: step.id };
}

function claimValuesFor(
  run: RunContext,
  step: FlowStepNode,
  attempt: number,
  input: Record<string, unknown>,
): ClaimStepValues {
  return {
    tenantId: run.tenantId,
    runId: run.id,
    stepId: step.id,
    stepName: step.name,
    kitId: step.kitId,
    actionName: step.actionName,
    attempt,
    input,
  };
}

/**
 * Marks the steps a stopped run never reached.
 *
 * Written rather than omitted so the journal shows the whole shape of the run. An author looking at a failure
 * should see which steps did not happen, not an absence they have to interpret.
 */
async function skipRemaining(
  db: Database,
  run: RunContext,
  steps: readonly FlowStepNode[],
  attempt: number,
): Promise<void> {
  for (const step of steps) {
    await recordSkippedStep(db, {
      tenantId: run.tenantId,
      runId: run.id,
      stepId: step.id,
      stepName: step.name,
      kitId: step.kitId,
      actionName: step.actionName,
      attempt,
    });
  }
}

export async function executeFlow(options: ExecuteFlowOptions): Promise<ExecutionOutcome> {
  const { db, run, definition, triggerPayload, attempt, host, credentials, logger } = options;
  const ordered = planExecutionOrder(definition);

  /**
   * What earlier steps produced, for the templates in later ones.
   *
   * Seeded from the journal rather than empty, so a retry can resolve `{{steps.Look up the order.id}}` against
   * the step that already succeeded instead of re-running it to find out.
   */
  const replayed = await findSucceededStepOutputs(db, run.id);
  // Computed once for the whole definition, so a key is the same on a retry as it was on the first attempt.
  const stepKeys = buildStepVariableKeys(definition.steps);
  let context = buildResolutionContext(triggerPayload);

  for (const step of definition.steps) {
    if (replayed.has(step.id)) {
      context = withStepOutput(context, stepKeys.get(step.id) ?? step.id, replayed.get(step.id));
    }
  }

  let failure: RunError | null = null;

  for (const [index, step] of ordered.entries()) {
    const action = findAction(step.kitId, step.actionName);

    if (!action) {
      // The definition was validated against the registry before the run started, so this means the snapshot
      // names something this build does not have — a kit removed between the save and the retry.
      failure = stepError(
        step,
        "FLOW_VALIDATION_FAILED",
        `"${step.name}" runs ${step.kitId}.${step.actionName}, which this worker does not have`,
      );
      await skipRemaining(db, run, ordered.slice(index + 1), attempt);
      break;
    }

    const resolution = resolveStepInput(action.props, step.input, context);

    if (!resolution.ok) {
      // Refused before the subprocess is involved, so nothing has touched the outside world.
      const claim = await claimStepRun(db, claimValuesFor(run, step, attempt, step.input));

      if (claim.outcome === "claimed") {
        await completeStepRun(db, claim.stepRunId, {
          status: "failed",
          output: null,
          error: stepError(step, "FLOW_VALIDATION_FAILED", resolution.failure.message),
        });
      }

      failure = stepError(step, "FLOW_VALIDATION_FAILED", `"${step.name}" cannot run — ${resolution.failure.message}`);

      if (!step.continueOnFailure) {
        await skipRemaining(db, run, ordered.slice(index + 1), attempt);
        break;
      }

      continue;
    }

    const claim: StepClaim = await claimStepRun(db, claimValuesFor(run, step, attempt, resolution.resolved.input));

    if (claim.outcome === "alreadyRecorded") {
      // Somebody already ran this exact attempt. Its result is authoritative and the action is *not* invoked
      // again — this is the branch that stops a retry sending a second email.
      logger.info({ runId: run.id, step: step.name, status: claim.status }, "step already recorded, replaying it");

      if (claim.status === "succeeded") {
        context = withStepOutput(context, stepKeys.get(step.id) ?? step.id, claim.output);
        continue;
      }

      failure = claim.error ?? stepError(step, "STEP_EXECUTION_FAILED", `"${step.name}" failed on an earlier attempt`);

      if (!step.continueOnFailure) {
        await skipRemaining(db, run, ordered.slice(index + 1), attempt);
        break;
      }

      continue;
    }

    const result = await host.runStep({
      kitId: step.kitId,
      actionName: step.actionName,
      stepName: step.name,
      input: resolution.resolved.input,
      credential: credentials.get(step.id) ?? null,
    });

    if (result.outcome === "succeeded") {
      await completeStepRun(db, claim.stepRunId, { status: "succeeded", output: result.output, error: null });
      context = withStepOutput(context, stepKeys.get(step.id) ?? step.id, result.output);
      continue;
    }

    const error = stepError(step, result.error.code, result.error.message);

    await completeStepRun(db, claim.stepRunId, { status: "failed", output: null, error });
    failure = error;

    if (!step.continueOnFailure) {
      await skipRemaining(db, run, ordered.slice(index + 1), attempt);
      break;
    }

    // The author asked for the run to carry on, so it does — but the failure is remembered, and the run's own
    // outcome reflects it. A run with a failed step did not fully succeed, whatever it was told to do next.
    logger.warn({ runId: run.id, step: step.name }, "step failed, carrying on as the flow asks");
  }

  return failure ? { status: "failed", error: failure } : { status: "succeeded", error: null };
}
