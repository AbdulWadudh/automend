/**
 * The engine subprocess: the only place a kit's code runs.
 *
 * Spawned once per run by `step-host.ts`, then asked to invoke one action at a time. What it does *not* have is
 * the point of it existing:
 *
 * - **No database client.** Nothing here can write. The journal, the run's status and the trigger store are all
 *   the parent's, so a kit cannot record something that did not happen or read another workspace's rows.
 * - **No secrets key.** Credentials arrive already resolved, one step at a time, as an access token rather than a
 *   refresh token — so what a compromised kit holds expires on its own and covers one service.
 * - **No `fetch` handed to kits.** They get the guarded client, which is what makes the address rules, the
 *   timeout and the response cap enforceable.
 * - **No environment.** The parent spawns this with a scrubbed `env`, so `DATABASE_URL` and `SECRETS_KEY` are not
 *   even present to be read.
 *
 * The protocol owns stdout — see `channel.ts` for why the transport is stdio rather than `Bun.spawn`'s `ipc`. So
 * `console` is redirected to stderr before any kit is loaded, which makes "a kit must not write to stdout" a thing
 * the process enforces rather than a rule somebody has to remember. A kit's own log lines go up as protocol
 * messages instead, attributed to the step that produced them.
 */

import type { KitCredential, KitLogger, KitStore } from "@automend/kit-framework";
import { findAction } from "@automend/kits";
import { API_ERROR_CODES, isAutomendError } from "@automend/shared";
import { createLineReader, decodeMessage, encodeMessage } from "./channel";
import { createGuardedHttpClient } from "./http-client";
import {
  type EngineLimits,
  type EngineLog,
  type EngineMessage,
  engineCommandSchema,
  type RateLimitGrant,
  type RunStepCommand,
} from "./protocol";

type ChildState = {
  run: { id: string; flowId: string; tenantId: string; idempotencyKey: string };
  limits: EngineLimits;
};

let state: ChildState | undefined;

/**
 * Everything that is not the protocol goes to stderr.
 *
 * Done before any kit module is imported, so a kit that writes to stdout — its own debugging, or a dependency's —
 * cannot corrupt the message stream. The parent captures stderr within its output cap, so the text is not lost.
 */
function redirectConsoleToStderr(): void {
  const toStderr =
    (level: string) =>
    (...args: unknown[]) => {
      process.stderr.write(`[engine ${level}] ${args.map((arg) => String(arg)).join(" ")}\n`);
    };

  console.log = toStderr("log");
  console.info = toStderr("info");
  console.warn = toStderr("warn");
  console.debug = toStderr("debug");
  console.error = toStderr("error");
}

redirectConsoleToStderr();

function send(message: EngineMessage): void {
  process.stdout.write(encodeMessage(message));
}

/**
 * A logger that reports upward instead of writing.
 *
 * The credential is never in scope here, so a kit cannot log one even by accident — the only things it can pass
 * are the message and its own fields.
 */
function createLogger(stepName: string): KitLogger {
  const emit = (level: EngineLog["level"]) => (message: string, fields?: Record<string, unknown>) => {
    send({ type: "log", level, stepName, message, fields });
  };

  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

/**
 * An action's store, which does nothing.
 *
 * Only triggers use `ctx.store`, and triggers do not run here — they are fired by the API or the scheduler, in
 * the parent, where the store lives. Handing an action a store that silently discarded writes would be worse
 * than one that refuses them: a kit would appear to remember something and quietly not.
 */
function createRefusingStore(stepName: string): KitStore {
  const refuse = () => {
    throw new Error(`"${stepName}" tried to use the trigger store, which only a trigger has`);
  };

  return { get: refuse, put: refuse, delete: refuse };
}

function describeError(error: unknown): { code: string; message: string } {
  if (isAutomendError(error)) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    // A kit throwing a plain error is normal, so it is classified as a step failure rather than treated as a bug
    // in the engine. The message is kept; the stack is not sent, because it would be noise in a run journal.
    return { code: API_ERROR_CODES.STEP_EXECUTION_FAILED, message: error.message };
  }

  return { code: API_ERROR_CODES.STEP_EXECUTION_FAILED, message: String(error) };
}

/** Grants still in flight, keyed by the id that correlates the reply. */
const pendingTokens = new Map<string, (grant: RateLimitGrant) => void>();

/**
 * Waits for the parent to say a request may go ahead.
 *
 * The bucket is Redis-backed and shared by every worker, and this process holds no Redis connection — by
 * design, since it holds no credentials either. So the wait happens on the other side of the pipe and this
 * only awaits the answer.
 */
function requestToken(commandId: string): Promise<void> {
  const requestId = crypto.randomUUID();

  return new Promise<void>((resolve, reject) => {
    pendingTokens.set(requestId, (grant) => {
      if (grant.granted) {
        resolve();

        return;
      }

      reject(new Error(grant.message ?? "This step was refused a rate-limit token"));
    });

    send({ type: "rateLimitRequest", requestId, commandId });
  });
}

async function runStep(command: RunStepCommand, current: ChildState): Promise<void> {
  const action = findAction(command.kitId, command.actionName);

  if (!action) {
    send({
      type: "stepResult",
      commandId: command.commandId,
      outcome: "failed",
      output: null,
      // The parent validates the definition against the registry before starting, so reaching this means the two
      // processes are running different builds — which is worth saying rather than reporting as a kit failure.
      error: {
        code: API_ERROR_CODES.FLOW_VALIDATION_FAILED,
        message: `This worker has no action called ${command.kitId}.${command.actionName}`,
      },
    });

    return;
  }

  try {
    const output = await action.invoke({
      input: command.input,
      auth: (command.credential ?? undefined) as KitCredential | undefined,
      http: createGuardedHttpClient(current.limits, () => requestToken(command.commandId)),
      store: createRefusingStore(command.stepName),
      run: current.run,
      step: { name: command.stepName },
      logger: createLogger(command.stepName),
    });

    send({ type: "stepResult", commandId: command.commandId, outcome: "succeeded", output, error: null });
  } catch (error) {
    send({
      type: "stepResult",
      commandId: command.commandId,
      outcome: "failed",
      output: null,
      error: describeError(error),
    });
  }
}

/**
 * Every command is parsed before it is acted on.
 *
 * The channel is a process boundary like any other, so what arrives over it is untrusted input. A malformed one is
 * not something to guess at: the parent is waiting on a `commandId` it will never see, and its own step timeout is
 * what turns that into an honest failure.
 */
function handleCommand(raw: unknown): void {
  const parsed = engineCommandSchema.safeParse(raw);

  if (!parsed.success) {
    // stderr rather than a message, because a message is exactly what could not be understood.
    console.error("engine child received an unreadable command");

    return;
  }

  const command = parsed.data;

  if (command.type === "hello") {
    state = { run: command.run, limits: command.limits };

    return;
  }

  if (command.type === "rateLimitGrant") {
    const settle = pendingTokens.get(command.requestId);

    pendingTokens.delete(command.requestId);
    settle?.(command);

    return;
  }

  const current = state;

  if (!current) {
    console.error("engine child was asked to run a step before being told which run it belongs to");

    return;
  }

  // Deliberately not awaited: `runStep` reports its own failures, so it cannot reject, and returning immediately
  // keeps the reader draining while a step runs.
  void runStep(command, current);
}

/**
 * Reads commands until the parent closes stdin.
 *
 * The loop ending is how a finished run looks from in here, so the process exits rather than waiting to be killed
 * — a parent that has finished with this child leaves no process behind.
 */
const reader = createLineReader();

for await (const chunk of Bun.stdin.stream()) {
  for (const line of reader.push(chunk)) {
    handleCommand(decodeMessage(line));
  }
}
