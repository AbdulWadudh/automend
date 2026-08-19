/**
 * The token bucket behind a kit's declared rate limit.
 *
 * It lives in Redis rather than in the worker because an in-process bucket is a limit that lies: run three
 * worker replicas and a service sees three times the quota, which is exactly the situation the limit exists
 * to prevent. Redis is the only place all of them can agree.
 *
 * It runs in the **parent**, never in the engine subprocess. The subprocess is spawned per run, so a bucket
 * there would only ever bound one run against itself.
 */

import type { KitRateLimit } from "@automend/kit-framework";
import { config } from "@automend/shared";
import type { Redis } from "ioredis";

const { keyPrefix, recheckIntervalCapMs, bucketTtlPeriods } = config.kits.limits;

/**
 * `HMGET`, refill, decide, `HSET` — as one script, because as four commands two workers interleave and both
 * spend the last token.
 *
 * Returns the milliseconds to wait: `0` means a token was taken. `now` is passed in rather than read from
 * `TIME`, which is not available to every server this runs against; the cost is that badly skewed worker
 * clocks make the bucket approximate rather than wrong.
 */
const ACQUIRE_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])

local state = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens = tonumber(state[1])
local updatedAt = tonumber(state[2])

if tokens == nil or updatedAt == nil then
  tokens = capacity
  updatedAt = nowMs
end

tokens = math.min(capacity, tokens + math.max(0, nowMs - updatedAt) * refillPerMs)

local waitMs = 0

if tokens >= 1 then
  tokens = tokens - 1
else
  waitMs = math.ceil((1 - tokens) / refillPerMs)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAt', nowMs)
redis.call('PEXPIRE', KEYS[1], ttlMs)

return waitMs
`;

/**
 * The hashtag goes around the bucket's own identity, so Dragonfly locks one bucket at a time. Wrapping the
 * prefix instead would put every limiter in the deployment on a single thread — the opposite of what a queue
 * name wants, and for the same reason.
 */
export function buildLimiterKey(scope: { tenantId: string; kitId: string; connectionId: string | undefined }): string {
  return `${keyPrefix}:{${scope.tenantId}:${scope.connectionId ?? scope.kitId}}:${scope.kitId}`;
}

export type RateLimiter = {
  /** Resolves once a token is held, or rejects when the budget runs out before one frees up. */
  acquire: (key: string, limit: KitRateLimit, budgetMs: number) => Promise<void>;
};

export type RateLimiterOptions = {
  redis: Redis;
  /** Injected so a test can drive the clock instead of sleeping through a real refill. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// ioredis types `defineCommand` as adding an untyped member, so the call site needs a shape to invoke.
type ScriptedRedis = Redis & {
  acquireKitToken: (key: string, capacity: string, refillPerMs: string, now: string, ttl: string) => Promise<number>;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const redis = options.redis as ScriptedRedis;

  // Registered once, and sent as EVALSHA thereafter — this runs on every request a kit makes.
  redis.defineCommand("acquireKitToken", { numberOfKeys: 1, lua: ACQUIRE_SCRIPT });

  async function acquire(key: string, limit: KitRateLimit, budgetMs: number): Promise<void> {
    const refillPerMs = limit.requests / (limit.perSeconds * 1_000);
    const ttlMs = Math.ceil(limit.perSeconds * 1_000 * bucketTtlPeriods);
    const deadline = now() + budgetMs;

    while (true) {
      const waitMs = await redis.acquireKitToken(
        key,
        String(limit.requests),
        String(refillPerMs),
        String(now()),
        String(ttlMs),
      );

      if (waitMs <= 0) {
        return;
      }

      if (now() + waitMs > deadline) {
        throw new Error(
          `Waiting for ${limit.requests} requests / ${limit.perSeconds}s would take longer than this step is allowed`,
        );
      }

      await sleep(Math.min(waitMs, recheckIntervalCapMs));
    }
  }

  return { acquire };
}
