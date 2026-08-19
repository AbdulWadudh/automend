/**
 * Asks a child for one dynamic dropdown's choices, then closes it.
 *
 * A separate host from the run's, because the two want opposite things. `step-host` keeps a child
 * alive across a run's steps and mediates rate-limit tokens against Redis; this spawns one, asks a
 * single question and kills it. Sharing one host would mean the api holding a rate limiter and a run
 * context it has no use for.
 *
 * The api calls this, and that is the whole reason `kit-runtime` is a package: the loader is kit code,
 * so it gets the same child with no database client, no secrets key and an allowlisted environment.
 */

import { config, stepExecutionError } from "@automend/shared";
import { createLineReader, decodeMessage, encodeMessage } from "./channel";
import { CHILD_ENTRY } from "./child-entry";
import { buildChildEnv } from "./child-env";
import { type DropdownChoice, type EngineCredential, engineMessageSchema, type LoadOptionsCommand } from "./protocol";

export type LoadOptionsRequest = {
  kitId: string;
  target: "action" | "trigger";
  targetName: string;
  propertyName: string;
  input: Record<string, unknown>;
  credential: EngineCredential | null;
  allowPrivateNetwork: boolean;
};

/**
 * Resolves with the choices, or throws a step failure carrying what the service said.
 *
 * The timeout is a step's rather than a run's: a person is watching a dropdown spin, and a loader
 * that has not answered by then is not going to.
 */
export async function loadDynamicOptions(request: LoadOptionsRequest): Promise<DropdownChoice[]> {
  const commandId = crypto.randomUUID();
  const command: LoadOptionsCommand = {
    type: "loadOptions",
    commandId,
    limits: buildEngineLimitsFor(request.allowPrivateNetwork),
    kitId: request.kitId,
    target: request.target,
    targetName: request.targetName,
    propertyName: request.propertyName,
    input: request.input,
    credential: request.credential,
  };

  // `bun <file>`, not `bun run <file>`: the latter resolves through the package manifest, which is a
  // step this does not need and a place a script name could shadow the entry.
  const child = Bun.spawn(["bun", CHILD_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv(),
    timeout: config.engine.stepTimeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: config.engine.maxOutputBytes,
  });

  try {
    child.stdin.write(encodeMessage(command));
    // Flushed explicitly: a buffered command is a child that never wakes up and a caller that waits
    // out the timeout for no reason.
    child.stdin.flush();

    return await readOptions(child, commandId);
  } finally {
    child.kill();
  }
}

async function readOptions(
  child: Bun.Subprocess<"pipe", "pipe", "pipe">,
  commandId: string,
): Promise<DropdownChoice[]> {
  const reader = createLineReader();
  const stream = child.stdout.getReader();

  try {
    while (true) {
      const { done, value } = await stream.read();

      if (done) {
        break;
      }

      for (const line of reader.push(value)) {
        const parsed = engineMessageSchema.safeParse(decodeMessage(line));

        if (!parsed.success || parsed.data.type !== "optionsResult" || parsed.data.commandId !== commandId) {
          // A log line from the loader, or a reply to something else. Neither is the answer.
          continue;
        }

        if (parsed.data.outcome === "failed") {
          throw stepExecutionError(parsed.data.error?.message ?? "The options could not be loaded");
        }

        return parsed.data.options;
      }
    }
  } finally {
    // Released rather than left locked, so `kill` can actually close the pipe — see step-host for the
    // Windows failure that taught us to own the reader instead of using `for await`.
    stream.releaseLock();
  }

  throw stepExecutionError("The options could not be loaded — the connection may need re-authorising");
}

function buildEngineLimitsFor(allowPrivateNetwork: boolean): LoadOptionsCommand["limits"] {
  const { http } = config.engine;

  return {
    requestTimeoutMs: http.requestTimeoutMs,
    maxRedirects: http.maxRedirects,
    maxResponseBytes: http.maxResponseBytes,
    allowPrivateNetwork,
    blockedHostnames: [...http.blockedHostnames],
  };
}
