/**
 * Turning a step's `connectionId` into something a kit can act with.
 *
 * Resolving one connection lives in `@automend/auth`, because the api needs the same answer when it loads a
 * dynamic dropdown's options. What is here is the part only a run has: walking a definition and failing early.
 */

import { type Auth, resolveConnectionCredential } from "@automend/auth";
import type { Database } from "@automend/db";
import type { EngineCredential } from "@automend/kit-runtime";
import { findKit } from "@automend/kits";
import type { FlowDefinition } from "@automend/shared";

export type ResolveCredentialsOptions = {
  db: Database;
  auth: Auth;
  secretsKey: Buffer;
  tenantId: string;
  definition: FlowDefinition;
};

export type ResolvedCredentials =
  | { ok: true; credentials: Map<string, EngineCredential> }
  /** Named so the run's failure says which step, and what to do about it. */
  | { ok: false; stepId: string; stepName: string; message: string };

/**
 * Every credential this run needs, keyed by step id.
 *
 * Resolved up front rather than per step, so a run that cannot get one of its credentials fails before it has
 * done half its work. A flow that sends an email and then posts to Slack should not send the email if the Slack
 * connection was revoked — the partial run is the worse outcome, because it is the one nobody can undo.
 */
export async function resolveRunCredentials(options: ResolveCredentialsOptions): Promise<ResolvedCredentials> {
  const { db, auth, secretsKey, tenantId, definition } = options;
  const credentials = new Map<string, EngineCredential>();

  for (const step of definition.steps) {
    const kit = findKit(step.kitId);

    if (!kit?.auth) {
      continue;
    }

    if (step.connectionId === undefined) {
      return {
        ok: false,
        stepId: step.id,
        stepName: step.name,
        message: `"${step.name}" needs a ${kit.displayName} connection, and none is chosen`,
      };
    }

    try {
      credentials.set(step.id, await resolveConnectionCredential(db, auth, secretsKey, tenantId, step.connectionId));
    } catch (error) {
      return {
        ok: false,
        stepId: step.id,
        stepName: step.name,
        message: `"${step.name}" could not use its ${kit.displayName} connection — ${(error as Error).message}`,
      };
    }
  }

  return { ok: true, credentials };
}
