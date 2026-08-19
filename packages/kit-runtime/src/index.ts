/**
 * The process kit code runs in, and the contract across its boundary.
 *
 * Separate from `kit-framework` because the split is a real one: the framework is what a kit is
 * *written against* and is browser-safe, so the builder may import it. This is where kit code is
 * *executed* — a subprocess with no database client, no secrets key and an allowlisted environment —
 * and nothing here belongs in a browser bundle.
 *
 * It is a package rather than part of the worker because the api needs the same isolation for the
 * same reason: loading a dynamic dropdown's options runs kit code against a live credential, and the
 * rule that such code never runs in an app's main process does not soften because the caller is
 * serving a request rather than a run.
 */

export { createLineReader, decodeMessage, encodeMessage } from "./channel";
export { CHILD_ENTRY } from "./child-entry";
export { createGuardedHttpClient } from "./http-client";
export * from "./protocol";
export { checkAddress } from "./ssrf-guard";
