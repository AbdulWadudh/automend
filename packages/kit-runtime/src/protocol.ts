/**
 * The contract across the process boundary.
 *
 * An IPC channel is a process boundary, so everything crossing it is untrusted input and is parsed with these
 * schemas on both ends — the same rule as a request body or a queue payload. A malformed message is a bug
 * somewhere, and the honest response to one is to fail the run rather than to act on half a message.
 *
 * **The parent drives the walk; the child executes one action at a time.** That is a deliberate departure from
 * the shape this was planned in, where the child would have walked the graph itself. Moving the walk to the
 * parent means:
 *
 * - Every database write — claiming a step, journalling its result, settling the run — stays in the parent. The
 *   child holds no connection and cannot be made to write anything.
 * - The child receives *one step's* input and *one* credential at a time, rather than every credential the run
 *   will need. A kit with a bug or a bad dependency reaches no further than the step it is running.
 * - The idempotency claim happens naturally: the parent claims the step, and only then asks for it to be run.
 * - There is no request/reply machinery for store reads or journal writes, because nothing in the child needs
 *   them.
 *
 * What the child is, then, is a sandbox for `invoke`: given an action to run, resolved input and a credential,
 * call it and report what happened. It is spawned once per run and kept alive across that run's steps, so the
 * spawn cost is paid once.
 */

import { config } from "@automend/shared";
import { z } from "zod";

/** What the child is told when it starts: only what bounds its behaviour, never where anything lives. */
export const engineLimitsSchema = z.object({
  requestTimeoutMs: z.number().int().positive(),
  maxRedirects: z.number().int().nonnegative(),
  maxResponseBytes: z.number().int().positive(),
  /** Loopback, link-local and private ranges are refused unless a deployment opts in. */
  allowPrivateNetwork: z.boolean(),
  blockedHostnames: z.array(z.string()),
});

export type EngineLimits = z.infer<typeof engineLimitsSchema>;

/**
 * The credential for one step, already resolved.
 *
 * An OAuth connection arrives as an access token rather than a refresh token and a client secret: refreshing
 * happens in the parent, where the secrets key lives, so a compromised child holds nothing reusable beyond the
 * lifetime of this token.
 */
export const engineCredentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("oauth"), connectorId: z.string(), accessToken: z.string() }),
  z.object({ kind: z.literal("token"), connectorId: z.string(), token: z.string() }),
]);

export type EngineCredential = z.infer<typeof engineCredentialSchema>;

export const runContextSchema = z.object({
  id: z.string(),
  flowId: z.string(),
  tenantId: z.string(),
  idempotencyKey: z.string(),
});

/** Sent once, before any step, so the child does not re-learn the run for every action. */
export const engineHelloSchema = z.object({
  type: z.literal("hello"),
  run: runContextSchema,
  limits: engineLimitsSchema,
});

export const runStepCommandSchema = z.object({
  type: z.literal("runStep"),
  /** Correlates the reply, since a reply may arrive after the parent has stopped waiting for it. */
  commandId: z.string(),
  kitId: z.string(),
  actionName: z.string(),
  stepName: z.string(),
  /** Templates already substituted and values already coerced, by the parent. */
  input: z.record(z.string(), z.unknown()),
  credential: engineCredentialSchema.nullable(),
});

/**
 * The parent's answer to a token request.
 *
 * The waiting happens in the parent, so the child simply awaits this. `granted: false` means the bucket could
 * not free a token inside the step's budget, and the message is what the run's journal will say.
 */
export const rateLimitGrantSchema = z.object({
  type: z.literal("rateLimitGrant"),
  requestId: z.string(),
  granted: z.boolean(),
  message: z.string().nullable(),
});

/**
 * List a dynamic dropdown's choices. One shot, and self-contained.
 *
 * It carries its own limits rather than relying on a preceding `hello`, because there is no run to
 * introduce: the api spawns a child, asks this, reads the answer and closes the pipe. A loader gets
 * no run context for the same reason — listing what a service holds is not part of any execution.
 */
export const loadOptionsCommandSchema = z.object({
  type: z.literal("loadOptions"),
  commandId: z.string(),
  limits: engineLimitsSchema,
  kitId: z.string(),
  /** A property map belongs to one or the other, and the same property name may exist in both. */
  target: z.enum(["action", "trigger"]),
  targetName: z.string(),
  propertyName: z.string(),
  /** What the author has configured so far, for a dropdown that narrows another. */
  input: z.record(z.string(), z.unknown()),
  credential: engineCredentialSchema.nullable(),
});

export const engineCommandSchema = z.discriminatedUnion("type", [
  engineHelloSchema,
  runStepCommandSchema,
  rateLimitGrantSchema,
  loadOptionsCommandSchema,
]);

export type EngineHello = z.infer<typeof engineHelloSchema>;
export type LoadOptionsCommand = z.infer<typeof loadOptionsCommandSchema>;
export type RunStepCommand = z.infer<typeof runStepCommandSchema>;
export type RateLimitGrant = z.infer<typeof rateLimitGrantSchema>;
export type EngineCommand = z.infer<typeof engineCommandSchema>;

/**
 * A line a kit logged.
 *
 * Sent as a message rather than written to stdout so it can be attributed to the step that produced it and
 * carried into the parent's structured logger, instead of arriving as unattributed text in the middle of the
 * worker's own output.
 */
export const engineLogSchema = z.object({
  type: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  stepName: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

export const stepResultSchema = z.object({
  type: z.literal("stepResult"),
  commandId: z.string(),
  outcome: z.enum(["succeeded", "failed"]),
  output: z.unknown(),
  /** Present when it failed. The code lets the parent classify the failure rather than match on text. */
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

/**
 * A kit is about to make a request and needs a token first.
 *
 * It names no bucket. Which one this draws from is decided by the parent from the step it is running, so a kit
 * cannot spend another connection's quota — the same reason the child is given one credential rather than the
 * means to fetch any.
 */
export const rateLimitRequestSchema = z.object({
  type: z.literal("rateLimitRequest"),
  requestId: z.string(),
  /** The step this request belongs to, so a late one cannot be attributed to the step that followed it. */
  commandId: z.string(),
});

/**
 * The choices, or why there are none.
 *
 * Capped at `config.kits.maxDynamicOptions` on the way out of the child rather than trusted: this
 * array crosses a pipe the parent reads into memory, so a workspace with tens of thousands of
 * channels would otherwise be a way to exhaust it.
 */
export const optionsResultSchema = z.object({
  type: z.literal("optionsResult"),
  commandId: z.string(),
  outcome: z.enum(["succeeded", "failed"]),
  options: z
    .array(z.object({ label: z.string(), value: z.string(), description: z.string().optional() }))
    .max(config.kits.maxDynamicOptions),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const engineMessageSchema = z.discriminatedUnion("type", [
  engineLogSchema,
  stepResultSchema,
  rateLimitRequestSchema,
  optionsResultSchema,
]);

export type EngineLog = z.infer<typeof engineLogSchema>;
export type StepResult = z.infer<typeof stepResultSchema>;
export type OptionsResult = z.infer<typeof optionsResultSchema>;
export type DropdownChoice = OptionsResult["options"][number];
export type RateLimitRequest = z.infer<typeof rateLimitRequestSchema>;
export type EngineMessage = z.infer<typeof engineMessageSchema>;

/** The limits as the parent configures them, from config rather than from anything a flow can influence. */
export function buildEngineLimits(allowPrivateNetwork: boolean): EngineLimits {
  const { http } = config.engine;

  return {
    requestTimeoutMs: http.requestTimeoutMs,
    maxRedirects: http.maxRedirects,
    maxResponseBytes: http.maxResponseBytes,
    allowPrivateNetwork,
    blockedHostnames: [...http.blockedHostnames],
  };
}
