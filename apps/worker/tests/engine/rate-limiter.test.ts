import { describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { buildLimiterKey, createRateLimiter, type RateLimiter } from "../../src/engine/rate-limiter";

/**
 * Against a real Redis, for the same reason `packages/db/tests` needs a real Postgres: the guarantee is that
 * two workers racing for the last token cannot both have it, and that is decided by the atomicity of the Lua
 * script rather than by anything in this repo. A fake would assert that the code calls the function it calls.
 *
 * It also exercises the server actually deployed — Dragonfly — where script support is worth verifying
 * rather than assuming.
 */

function redisUrl(): string | undefined {
  const url = process.env.REDIS_URL;

  return url && url.length > 0 ? url : undefined;
}

const hasRedis = redisUrl() !== undefined;
const describeWithRedis = hasRedis ? describe : describe.skip;

if (!hasRedis) {
  console.warn("Skipping rate limiter tests: REDIS_URL is not set. Run `bun run dev:up` for a server.");
}

describeWithRedis("the kit rate limiter", () => {
  /** A fresh bucket per test, so one test's spending is never another's starting point. */
  function freshKey(): string {
    return buildLimiterKey({ tenantId: "tenant", kitId: "gmail", connectionId: crypto.randomUUID() });
  }

  /** A client per test, closed when it ends, so nothing leaks between them. */
  async function withLimiter<T>(body: (limiter: RateLimiter) => Promise<T>): Promise<T> {
    const redis = new Redis(redisUrl() ?? "", { maxRetriesPerRequest: 2 });

    try {
      return await body(createRateLimiter({ redis }));
    } finally {
      await redis.quit();
    }
  }

  test("a fresh bucket grants its whole capacity without waiting", async () => {
    await withLimiter(async (limiter) => {
      const key = freshKey();

      for (let taken = 0; taken < 5; taken += 1) {
        await limiter.acquire(key, { requests: 5, perSeconds: 60 }, 100);
      }
    });
  });

  test("an exhausted bucket refuses rather than waiting past the step's budget", async () => {
    await withLimiter(async (limiter) => {
      const key = freshKey();
      const limit = { requests: 2, perSeconds: 600 };

      await limiter.acquire(key, limit, 100);
      await limiter.acquire(key, limit, 100);

      /**
       * Caught by hand rather than with `expect(...).rejects.toThrow()`, which hangs here: the matcher never
       * settles under `bun test` and takes the whole file's timeout with it. The assertion is the same.
       */
      let refusal: Error | undefined;

      try {
        await limiter.acquire(key, limit, 100);
      } catch (error) {
        refusal = error as Error;
      }

      expect(refusal?.message).toMatch(/longer than this step is allowed/);
    });
  });

  /** Refill is what makes this a rate limit rather than a quota: the bucket comes back on its own. */
  test("it refills over time, so a caller that waits is served", async () => {
    await withLimiter(async (limiter) => {
      const key = freshKey();
      const limit = { requests: 4, perSeconds: 1 };

      for (let taken = 0; taken < 4; taken += 1) {
        await limiter.acquire(key, limit, 50);
      }

      const started = Date.now();

      await limiter.acquire(key, limit, 2_000);

      // A quarter-second per token at 4/s. Asserts that it waited, not how precisely.
      expect(Date.now() - started).toBeGreaterThan(50);
    });
  });

  /**
   * The one that matters. Separate clients are what separate worker replicas are; an in-process bucket would
   * let every one of them spend the same last token, which is the failure this design exists to prevent.
   */
  test("workers racing for the last token do not both get it", async () => {
    const key = freshKey();
    const limit = { requests: 1, perSeconds: 600 };
    const clients = Array.from({ length: 4 }, () => new Redis(redisUrl() ?? "", { maxRetriesPerRequest: 2 }));

    try {
      const results = await Promise.allSettled(
        clients.map((client) => createRateLimiter({ redis: client }).acquire(key, limit, 50)),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((client) => client.quit()));
    }
  });

  test("two connections of the same kit do not share a bucket", async () => {
    await withLimiter(async (limiter) => {
      const limit = { requests: 1, perSeconds: 600 };

      await limiter.acquire(freshKey(), limit, 50);
      // Would reject if the key were built from the kit rather than the connection.
      await limiter.acquire(freshKey(), limit, 50);
    });
  });

  test("the bucket's identity carries the Dragonfly hashtag, not the prefix", () => {
    const key = buildLimiterKey({ tenantId: "tenant", kitId: "gmail", connectionId: "connection" });

    // Every bucket needs its own hashtag, or they all lock on one thread — the opposite of a queue name.
    expect(key).toContain("{tenant:connection}");
    expect(key.startsWith("{")).toBe(false);
  });
});
