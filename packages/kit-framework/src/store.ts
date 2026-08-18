/**
 * The small amount of state a kit is allowed to remember between firings.
 *
 * Scoped per tenant, flow and trigger by whoever implements it, so a kit cannot name a key that
 * reaches another workspace's data. Its purpose is deduplication — "which message did I last see" —
 * not general storage, which is why there is no list or scan.
 *
 * `get` returns `unknown` rather than a generic. The value came back from a JSON column, so a
 * generic here would be an assertion dressed up as a type; callers narrow it instead.
 */
export type KitStore = {
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
};
