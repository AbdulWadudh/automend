import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { initialiseDedupe, type LastItemPoll, pollWithDedupe, type TimestampPoll, testPoll } from "../src/dedupe";
import type { KitStore } from "../src/store";

/**
 * Deduplication decides whether a flow runs twice for one email or misses one entirely, so it is
 * worth more tests than anything else in this package. Both strategies are exercised against a real
 * in-memory store rather than a mock, because the cursor round-tripping through storage is the part
 * that goes wrong.
 */

function createMemoryStore(seed: Record<string, unknown> = {}): KitStore & { snapshot: () => Record<string, unknown> } {
  const values = new Map<string, unknown>(Object.entries(seed));

  return {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    snapshot: () => Object.fromEntries(values),
  };
}

function timestampPoll(items: readonly { occurredAtMs: number; data: unknown }[]): TimestampPoll {
  return { strategy: "timestamp", fetch: async () => items };
}

/** Newest first, which is the order a listing endpoint returns. */
function lastItemPoll(items: readonly { id: string; data: unknown }[]): LastItemPoll {
  return { strategy: "lastItem", fetch: async () => items };
}

describe("the timestamp strategy", () => {
  test("nothing is new on the first poll after enabling", async () => {
    const store = createMemoryStore();
    const poll = timestampPoll([{ occurredAtMs: 500, data: "old" }]);

    await initialiseDedupe(poll, store, 1_000);

    expect(await pollWithDedupe(poll, store)).toEqual([]);
  });

  test("only items after the cursor come back, oldest first", async () => {
    const store = createMemoryStore();
    const poll = timestampPoll([
      { occurredAtMs: 300, data: "before" },
      { occurredAtMs: 900, data: "later" },
      { occurredAtMs: 700, data: "sooner" },
    ]);

    await initialiseDedupe(poll, store, 500);

    expect(await pollWithDedupe(poll, store)).toEqual(["sooner", "later"]);
  });

  test("a second poll with the same answer returns nothing", async () => {
    const store = createMemoryStore();
    const poll = timestampPoll([{ occurredAtMs: 900, data: "one" }]);

    await initialiseDedupe(poll, store, 500);
    await pollWithDedupe(poll, store);

    expect(await pollWithDedupe(poll, store)).toEqual([]);
  });

  test("an item exactly on the cursor is not re-reported", async () => {
    const store = createMemoryStore();
    const poll = timestampPoll([{ occurredAtMs: 500, data: "boundary" }]);

    await initialiseDedupe(poll, store, 500);

    expect(await pollWithDedupe(poll, store)).toEqual([]);
  });

  test("the cursor is left alone when nothing was new, so a clock skew cannot skip items", async () => {
    const store = createMemoryStore();
    const poll = timestampPoll([]);

    await initialiseDedupe(poll, store, 500);
    const before = store.snapshot();
    await pollWithDedupe(poll, store);

    expect(store.snapshot()).toEqual(before);
  });
});

describe("the last-item strategy", () => {
  test("everything visible is marked seen when the trigger is enabled", async () => {
    const store = createMemoryStore();
    const poll = lastItemPoll([
      { id: "c", data: "third" },
      { id: "b", data: "second" },
    ]);

    await initialiseDedupe(poll, store, 0);

    expect(await pollWithDedupe(poll, store)).toEqual([]);
  });

  test("items newer than the cursor come back oldest first", async () => {
    const store = createMemoryStore();
    const initial = lastItemPoll([{ id: "a", data: "first" }]);

    await initialiseDedupe(initial, store, 0);

    const later = lastItemPoll([
      { id: "c", data: "third" },
      { id: "b", data: "second" },
      { id: "a", data: "first" },
    ]);

    expect(await pollWithDedupe(later, store)).toEqual(["second", "third"]);
  });

  test("an empty feed at enable time leaves no cursor, so the first arrival counts as new", async () => {
    const store = createMemoryStore();

    await initialiseDedupe(lastItemPoll([]), store, 0);

    expect(await pollWithDedupe(lastItemPoll([{ id: "a", data: "first" }]), store)).toEqual(["first"]);
  });

  /**
   * The cursor ageing out of the listing is the interesting failure. Re-reporting is recoverable —
   * the run's idempotency key stops the side effect happening twice — whereas concluding that
   * nothing is new would drop every event since silently.
   */
  test("a cursor that has aged out of the listing re-reports rather than skipping", async () => {
    const store = createMemoryStore();

    await initialiseDedupe(lastItemPoll([{ id: "gone", data: "aged out" }]), store, 0);

    const rolled = lastItemPoll([
      { id: "z", data: "newest" },
      { id: "y", data: "older" },
    ]);

    expect(await pollWithDedupe(rolled, store)).toEqual(["older", "newest"]);
  });

  test("a backlog is capped, and drains from the oldest end so nothing is skipped", async () => {
    const store = createMemoryStore();
    const { maxPollItems } = config.kits;
    // Newest first, ids counting down, so item 0 is the newest.
    const backlog = Array.from({ length: maxPollItems + 5 }, (_, index) => ({
      id: `id-${maxPollItems + 5 - index}`,
      data: maxPollItems + 5 - index,
    }));

    const first = await pollWithDedupe(lastItemPoll(backlog), store);

    expect(first).toHaveLength(maxPollItems);
    expect(first[0]).toBe(1);

    const second = await pollWithDedupe(lastItemPoll(backlog), store);

    expect(second).toEqual([maxPollItems + 1, maxPollItems + 2, maxPollItems + 3, maxPollItems + 4, maxPollItems + 5]);
  });
});

describe("testing a trigger from the builder", () => {
  test("shows recent items without moving the cursor", async () => {
    const store = createMemoryStore();
    const poll = lastItemPoll([
      { id: "b", data: "second" },
      { id: "a", data: "first" },
    ]);

    await initialiseDedupe(poll, store, 0);
    const before = store.snapshot();

    expect(await testPoll(poll)).toEqual(["second", "first"]);
    expect(store.snapshot()).toEqual(before);
  });

  test("returns newest first and no more than the configured sample size", async () => {
    const items = Array.from({ length: config.kits.testPollItems + 3 }, (_, index) => ({
      occurredAtMs: index,
      data: index,
    }));

    const sample = await testPoll(timestampPoll(items));

    expect(sample).toHaveLength(config.kits.testPollItems);
    expect(sample[0]).toBe(config.kits.testPollItems + 2);
  });
});
