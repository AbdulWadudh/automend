/**
 * The transport between the parent and the engine subprocess: newline-delimited JSON over stdio.
 *
 * **Not `Bun.spawn`'s `ipc` option, and that is not a style preference.** On Windows the IPC pipe does not start —
 * the child gets a `process.send` that is a function and a channel that never connects, so the parent waits out
 * its step timeout with nothing on stdout to explain it:
 *
 *     warn: Unable to start IPC pipe '3[libuv]'
 *
 * stdio works on every platform, which for a self-hosted product is the requirement.
 *
 * Two consequences worth knowing, both of which turned out to be improvements:
 *
 * 1. **The protocol owns the child's stdout**, so `child.ts` redirects `console` to stderr before loading any kit.
 *    That makes "a kit must not write to stdout" *enforced* rather than a rule somebody has to remember — and a
 *    kit's stray `console.log` lands in stderr, where the parent captures it under `maxBuffer`.
 * 2. **Messages are JSON**, not structured clones. That is the right fidelity rather than a loss: a step's input
 *    and output are written to `jsonb` columns, so anything JSON cannot carry could not have been stored anyway.
 */

const DELIMITER = "\n";

export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}${DELIMITER}`;
}

/**
 * Splits a byte stream into whole lines.
 *
 * A chunk boundary falls wherever the operating system decides, so a message can arrive in two pieces and two
 * messages can arrive in one. Buffering the remainder is the whole job; parsing a partial line would produce a
 * syntax error that looks like a protocol bug.
 */
export function createLineReader(): { push: (chunk: Uint8Array) => string[] } {
  const decoder = new TextDecoder();
  let buffered = "";

  return {
    push(chunk: Uint8Array): string[] {
      buffered += decoder.decode(chunk, { stream: true });

      const lines = buffered.split(DELIMITER);

      // The last piece is whatever came after the final delimiter — an incomplete message, or nothing.
      buffered = lines.pop() ?? "";

      return lines.filter((line) => line.trim().length > 0);
    },
  };
}

/** `undefined` for a line that is not JSON, so a caller reports a protocol problem rather than throwing here. */
export function decodeMessage(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}
