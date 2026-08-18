/**
 * Deduplication for polling triggers.
 *
 * A polling trigger asks a service "what have you got?" every few minutes and gets back a list that
 * mostly repeats last time's answer. Turning that into "what is new" is the same problem for every
 * service, and getting it wrong means either running a flow twice for one email or missing one
 * entirely — so it is solved once here rather than in each kit.
 *
 * Two strategies, because services offer two different guarantees:
 *
 * - `timestamp` — the service dates its records, so anything newer than the last poll is new. Suits
 *   a search API with a date filter.
 * - `lastItem` — the service only promises an order, so everything before the last id we saw is old.
 *   Suits a feed or an inbox listing.
 *
 * Both keep their cursor in the `KitStore`, which is scoped per trigger by the engine.
 */

import { config } from "@automend/shared";
import type { KitStore } from "./store";

export type DedupeStrategy = (typeof config.kits.dedupeStrategies)[number];

/**
 * Where each strategy keeps its cursor. Module-local because nothing outside this file reads them —
 * a constant with one consumer is a second name for a string, not a configured value.
 */
const CURSOR_KEY: Readonly<Record<DedupeStrategy, string>> = {
  timestamp: "dedupe:lastPolledAtMs",
  lastItem: "dedupe:lastItemId",
};

export type TimestampPoll = {
  strategy: "timestamp";
  /**
   * Everything the service knows about at or after `sinceMs`. Ordering does not matter — the filter
   * below is on the timestamp, not on position.
   */
  fetch: (sinceMs: number) => Promise<readonly { occurredAtMs: number; data: unknown }[]>;
};

export type LastItemPoll = {
  strategy: "lastItem";
  /** Newest first. `lastItemId` is undefined on the very first poll. */
  fetch: (lastItemId: string | undefined) => Promise<readonly { id: string; data: unknown }[]>;
};

export type Poll = TimestampPoll | LastItemPoll;

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Marks everything currently visible as already seen.
 *
 * Called from `onEnable`, and the reason it matters: without it, switching a trigger on would treat
 * the entire existing inbox as new and start a run for every message in it.
 */
export async function initialiseDedupe(poll: Poll, store: KitStore, nowMs: number): Promise<void> {
  if (poll.strategy === "timestamp") {
    await store.put(CURSOR_KEY.timestamp, nowMs);

    return;
  }

  const items = await poll.fetch(undefined);
  const newest = items[0];

  if (newest) {
    await store.put(CURSOR_KEY.lastItem, newest.id);
  } else {
    // No cursor rather than a stale one: the next poll treats whatever appears first as new, which
    // is correct for a feed that is empty today.
    await store.delete(CURSOR_KEY.lastItem);
  }
}

/**
 * The items that are new since the last poll, and the cursor advanced past them.
 *
 * Capped at `config.kits.maxPollItems`. A trigger that has been off for a week must not hand the
 * engine ten thousand runs at once; the cap is applied to the *oldest* of the new items so the
 * backlog drains in order across successive polls rather than skipping to the present.
 */
export async function pollWithDedupe(poll: Poll, store: KitStore): Promise<unknown[]> {
  const { maxPollItems } = config.kits;

  if (poll.strategy === "timestamp") {
    const sinceMs = readNumber(await store.get(CURSOR_KEY.timestamp)) ?? 0;
    const items = await poll.fetch(sinceMs);
    const fresh = items
      .filter((item) => item.occurredAtMs > sinceMs)
      .sort((left, right) => left.occurredAtMs - right.occurredAtMs)
      .slice(0, maxPollItems);
    const advanced = fresh.reduce((latest, item) => Math.max(latest, item.occurredAtMs), sinceMs);

    if (advanced > sinceMs) {
      await store.put(CURSOR_KEY.timestamp, advanced);
    }

    return fresh.map((item) => item.data);
  }

  const lastItemId = readString(await store.get(CURSOR_KEY.lastItem));
  const items = await poll.fetch(lastItemId);
  const seenAt = lastItemId === undefined ? -1 : items.findIndex((item) => item.id === lastItemId);
  // Not finding the cursor means the item aged out of the listing, so everything visible is treated
  // as new. Over-reporting is recoverable — the run's idempotency key stops a duplicate side effect —
  // whereas assuming nothing is new would silently drop every event since.
  const unseen = seenAt === -1 ? [...items] : items.slice(0, seenAt);
  // Oldest first, so the flow runs in the order things actually happened.
  const fresh = unseen.reverse().slice(0, maxPollItems);
  const newest = fresh.at(-1);

  if (newest) {
    await store.put(CURSOR_KEY.lastItem, newest.id);
  }

  return fresh.map((item) => item.data);
}

/**
 * What the builder shows when someone tests a trigger: recent items, whatever the cursor says.
 *
 * Reads nothing and writes nothing, so testing a trigger cannot cause the next real poll to skip the
 * items it just displayed.
 */
export async function testPoll(poll: Poll): Promise<unknown[]> {
  const limit = config.kits.testPollItems;

  if (poll.strategy === "timestamp") {
    const items = await poll.fetch(0);

    return items
      .toSorted((left, right) => right.occurredAtMs - left.occurredAtMs)
      .slice(0, limit)
      .map((item) => item.data);
  }

  const items = await poll.fetch(undefined);

  return items.slice(0, limit).map((item) => item.data);
}
