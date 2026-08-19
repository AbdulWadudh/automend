/**
 * Reading Block Kit out of what an author pasted.
 *
 * Slack's Block Kit Builder — which is where almost everybody composes these — copies out
 * `{"blocks": [...]}`, while `chat.postMessage` takes the array itself. Accepting either is the
 * difference between "works when you paste from the tool everyone uses" and "does not", so both are
 * read rather than one being declared correct.
 *
 * The blocks are checked for shape and then handed on **unmodified**. A schema that rebuilt them
 * would silently drop every field it had not been taught, and Slack adds block types faster than this
 * file will be edited — so the rule is: verify enough to fail usefully, then do not touch it.
 */

import { stepExecutionError } from "@automend/shared";

/** Slack refuses more than this in one message, and says so unhelpfully when you exceed it. */
const MAX_BLOCKS = 50;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The blocks to send, or undefined when the field was left empty.
 *
 * Undefined rather than an empty array: `blocks: []` is a *request to render nothing*, which Slack
 * accepts and which posts an empty message. A field nobody filled in must not mean that.
 */
export function parseSlackBlocks(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const candidate = isObject(value) && "blocks" in value ? value.blocks : value;

  if (!Array.isArray(candidate)) {
    throw stepExecutionError(
      'Blocks must be a JSON array, or the object Slack\'s Block Kit Builder copies out — the one with a "blocks" key',
    );
  }

  if (candidate.length === 0) {
    return undefined;
  }

  if (candidate.length > MAX_BLOCKS) {
    throw stepExecutionError(
      `Slack accepts at most ${MAX_BLOCKS} blocks in a message, and this has ${candidate.length}`,
    );
  }

  candidate.forEach((block, index) => {
    if (!isObject(block) || typeof block.type !== "string" || block.type.length === 0) {
      // Named by position, because a person looking at 40 blocks needs to know which one.
      throw stepExecutionError(`Block ${index + 1} is not a Block Kit block — each one needs a "type"`);
    }
  });

  return candidate;
}
