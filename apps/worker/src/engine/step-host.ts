/**
 * Spawning the engine subprocess and asking it to run steps.
 *
 * What this enforces is what Bun's spawn options actually give us, and it is worth being precise about, because
 * the gap between that and "sandboxed" is where a false sense of safety lives:
 *
 * | Enforced here                          | How                                                    |
 * |----------------------------------------|--------------------------------------------------------|
 * | Wall-clock cap on the whole run        | `timeout` + `killSignal` on the spawn                  |
 * | Wall-clock cap on a single step        | a race in `runStep`, which kills the child on overrun   |
 * | Output cap                             | `maxBuffer`                                             |
 * | No access to secrets or the database   | a scrubbed `env`                                        |
 *
 * **Not enforced, because Bun's spawn options do not provide it:** memory, CPU, filesystem or network isolation.
 * A memory ceiling is a container-level concern — `--memory` on the container, or a cgroup — and is documented
 * as such rather than pretended to here. `uid`/`gid` would drop privileges but are POSIX-only and fail outright
 * on Windows, so they are deliberately unused.
 *
 * The transport is newline-delimited JSON over stdio rather than `Bun.spawn`'s `ipc` option, because that option's
 * pipe does not start on Windows — see `channel.ts` for the failure and what it buys us.
 */

import type { KitRateLimit } from "@automend/kit-framework";
import {
  buildChildEnv,
  CHILD_ENTRY,
  createLineReader,
  decodeMessage,
  type EngineCredential,
  type EngineLimits,
  type EngineMessage,
  encodeMessage,
  engineMessageSchema,
  type RateLimitRequest,
  type StepResult,
} from "@automend/kit-runtime";
import { config } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";

import type { RateLimiter } from "./rate-limiter";

export type RunContext = {
  id: string;
  flowId: string;
  tenantId: string;
  idempotencyKey: string;
};

export type StepInvocation = {
  kitId: string;
  actionName: string;
  stepName: string;
  input: Record<string, unknown>;
  credential: EngineCredential | null;
  /** The bucket this step's requests draw from, and how big it is. Absent for a kit that declares no limit. */
  rateLimit: { key: string; limit: KitRateLimit } | null;
};

export type StepOutcome =
  | { outcome: "succeeded"; output: unknown }
  | { outcome: "failed"; error: { code: string; message: string } };

export type StepHost = {
  runStep: (invocation: StepInvocation) => Promise<StepOutcome>;
  /** Kills the child and resolves once it is gone. Safe to call more than once. */
  close: () => Promise<void>;
};

export type CreateStepHostOptions = {
  run: RunContext;
  limits: EngineLimits;
  logger: Logger;
  /** Absent on a deployment with no Redis reachable from the worker, which leaves kits unthrottled. */
  limiter?: RateLimiter;
};

export function createStepHost({ run, limits, logger, limiter }: CreateStepHostOptions): StepHost {
  const { engine } = config;
  /** Resolvers for commands still in flight, keyed by the id that correlates the reply. */
  const pending = new Map<string, (result: StepResult) => void>();
  /** Which bucket each in-flight step draws from. The child names a step, never a bucket. */
  const buckets = new Map<string, { key: string; limit: KitRateLimit }>();
  let closed = false;

  function handleMessage(raw: unknown): void {
    const parsed = engineMessageSchema.safeParse(raw);

    if (!parsed.success) {
      logger.warn({ runId: run.id }, "engine sent an unreadable message");

      return;
    }

    const message: EngineMessage = parsed.data;

    if (message.type === "rateLimitRequest") {
      void grantToken(message);

      return;
    }

    if (message.type === "log") {
      // Folded into the worker's own structured logging, attributed to the step that produced it.
      logger[message.level](
        { runId: run.id, flowId: run.flowId, tenantId: run.tenantId, step: message.stepName, ...message.fields },
        message.message,
      );

      return;
    }

    if (message.type === "optionsResult") {
      // This host never asks for options — that is the api's one-shot host. A child answering one here
      // is a bug worth naming rather than a step result to mis-record.
      logger.warn({ runId: run.id, commandId: message.commandId }, "engine answered with options nobody asked for");

      return;
    }

    const resolve = pending.get(message.commandId);

    if (!resolve) {
      // The parent stopped waiting — the step timed out and was already recorded as failed. Recording a second
      // outcome now would overwrite an honest failure with a late success.
      logger.warn({ runId: run.id, commandId: message.commandId }, "engine answered a step nobody is waiting for");

      return;
    }

    pending.delete(message.commandId);
    buckets.delete(message.commandId);
    resolve(message);
  }

  /**
   * Waits for the step's bucket, then tells the child to go.
   *
   * The wait happens here rather than in the child because the bucket is shared: it is Redis-backed so that
   * every worker replica draws from the same one, and the child holds no Redis connection by design.
   *
   * A step whose bucket the parent no longer knows — because the step already timed out — is refused rather
   * than granted, so a late request cannot spend the next step's quota.
   */
  async function grantToken(request: RateLimitRequest): Promise<void> {
    const bucket = buckets.get(request.commandId);

    if (!limiter || !bucket) {
      send({
        type: "rateLimitGrant",
        requestId: request.requestId,
        granted: limiter === undefined,
        message: limiter === undefined ? null : "This step is no longer running",
      });

      return;
    }

    try {
      await limiter.acquire(bucket.key, bucket.limit, config.kits.limits.waitBudgetMs);
      send({ type: "rateLimitGrant", requestId: request.requestId, granted: true, message: null });
    } catch (error) {
      send({
        type: "rateLimitGrant",
        requestId: request.requestId,
        granted: false,
        message: error instanceof Error ? error.message : "This step could not get a rate-limit token",
      });
    }
  }

  // `bun <file>`, not `bun run <file>`: the latter resolves through the package manifest, which is a step this
  // does not need and a place a script name could shadow the entry.
  const child = Bun.spawn(["bun", CHILD_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv(),
    // The run's own ceiling. A child that has ignored everything else still stops here.
    timeout: engine.runTimeoutMs,
    killSignal: "SIGKILL",
    // Bounds what a kit logging in a loop can push through the pipe the parent is reading.
    maxBuffer: engine.maxOutputBytes,
  });

  function send(command: unknown): void {
    child.stdin.write(encodeMessage(command));
    // Flushed explicitly: a buffered command is a child that never wakes up and a parent that waits out its
    // step timeout for no reason.
    child.stdin.flush();
  }

  /**
   * The stream reader is held rather than iterated with `for await`.
   *
   * A `for await` loop takes an exclusive lock on the stream, so `close` cannot cancel it — the cancel throws
   * "locked", the loop keeps waiting on a killed child whose pipe Windows has not closed, and the process stays
   * alive. Owning the reader means `close` can actually stop it.
   */
  const output = child.stdout.getReader();

  /**
   * Reads the child's stdout for as long as it lives.
   *
   * Deliberately not awaited — it runs for the child's whole lifetime, and awaiting it here would mean never
   * returning the host. Its failures are logged rather than thrown, because a stream that ends is how a killed
   * child looks and every pending step is already answered by `close`.
   */
  async function readMessages(): Promise<void> {
    const lines = createLineReader();

    while (true) {
      const { done, value } = await output.read();

      if (done) {
        return;
      }

      for (const line of lines.push(value)) {
        handleMessage(decodeMessage(line));
      }
    }
  }

  void readMessages().catch((error: unknown) => {
    logger.warn({ err: error, runId: run.id }, "engine output stream ended unexpectedly");
  });

  /**
   * The child's stderr, drained and logged.
   *
   * Piping a stream and never reading it is not a no-op: the pipe fills, the process holds it open, and the worker
   * never exits. It is also where a kit's stray `console.log` ends up — `child.ts` redirects `console` there so the
   * protocol keeps stdout — so leaving it unread would mean claiming the parent captures that output while
   * discarding it.
   */
  const diagnostics = child.stderr.getReader();

  async function readDiagnostics(): Promise<void> {
    const lines = createLineReader();

    while (true) {
      const { done, value } = await diagnostics.read();

      if (done) {
        return;
      }

      for (const line of lines.push(value)) {
        logger.warn({ runId: run.id, engine: true }, line);
      }
    }
  }

  void readDiagnostics().catch(() => {
    // A stream that ends is how a killed child looks; there is nothing to report about it.
  });

  send({ type: "hello", run, limits });

  async function close(): Promise<void> {
    if (closed) {
      return;
    }

    closed = true;

    // Anything still waiting is answered rather than left hanging, so a caller cannot be stranded on a promise
    // whose child has gone.
    for (const [commandId, resolve] of pending) {
      resolve({
        type: "stepResult",
        commandId,
        outcome: "failed",
        output: null,
        error: { code: "STEP_EXECUTION_FAILED", message: "The engine stopped before this step finished" },
      });
    }

    pending.clear();
    buckets.clear();

    // stdin is closed first so a child between steps sees the stream end and exits on its own, rather than being
    // killed mid-write.
    try {
      child.stdin.end();
    } catch {
      // Already gone, which is the normal case when the run finished by the child exiting.
    }

    child.kill();

    /**
     * Waited for, so a finished run leaves no process behind — and bounded, so a child that will not die cannot
     * hold the worker's shutdown open.
     *
     * The timer is cleared rather than left to fire. A pending `setTimeout` keeps the event loop alive, which in a
     * long-lived worker is a slow leak of one timer per run, and in a short script is a process that will not exit.
     */
    let grace: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        child.exited,
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, engine.shutdownGraceMs);
        }),
      ]);
    } finally {
      if (grace) {
        clearTimeout(grace);
      }

      // Cancelled explicitly: a killed child's stdout does not always end on its own — notably on Windows — and a
      // read that never resolves holds the process open for as long as it lasts.
      await Promise.all([output.cancel().catch(() => {}), diagnostics.cancel().catch(() => {})]);
    }
  }

  async function runStep(invocation: StepInvocation): Promise<StepOutcome> {
    if (closed) {
      return { outcome: "failed", error: { code: "STEP_EXECUTION_FAILED", message: "The engine has stopped" } };
    }

    const commandId = crypto.randomUUID();
    const { rateLimit, ...command } = invocation;

    const answered = new Promise<StepResult>((resolve) => {
      pending.set(commandId, resolve);
    });

    if (rateLimit) {
      buckets.set(commandId, rateLimit);
    }

    // `rateLimit` is deliberately not sent: the child asks for tokens, it does not get to say from where.
    send({ type: "runStep", commandId, ...command });

    /**
     * The per-step ceiling, which the spawn's own `timeout` cannot express — that one bounds the whole run.
     *
     * A step that overruns takes the child with it. There is no way to interrupt a single action from outside it:
     * a kit stuck in a loop is not going to check a flag, and leaving it running would consume the rest of the
     * run's budget. So the process goes, and the caller records the failure.
     */
    const timedOut = Bun.sleep(config.engine.stepTimeoutMs).then(() => "timeout" as const);
    const settled = await Promise.race([answered, timedOut]);

    if (settled === "timeout") {
      pending.delete(commandId);
      buckets.delete(commandId);
      logger.warn({ runId: run.id, step: invocation.stepName }, "step exceeded its time limit");
      await close();

      return {
        outcome: "failed",
        error: {
          code: "STEP_EXECUTION_FAILED",
          message: `"${invocation.stepName}" did not finish within ${config.engine.stepTimeoutMs} ms`,
        },
      };
    }

    if (settled.outcome === "succeeded") {
      return { outcome: "succeeded", output: settled.output };
    }

    return {
      outcome: "failed",
      error: settled.error ?? { code: "STEP_EXECUTION_FAILED", message: "The step failed without saying why" },
    };
  }

  return { runStep, close };
}
