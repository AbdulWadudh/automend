/**
 * Dependency probing shared by the API and the worker health endpoints.
 *
 * A probe is always bounded by a timeout: an unreachable Redis or Postgres must make `/health`
 * answer "down" promptly, not hang until the orchestrator's own probe timeout fires.
 */

import type { DependencyHealth } from "./api";
import { config } from "./config";

export type DependencyProbe = {
  name: string;
  check: () => Promise<unknown>;
  timeoutMs?: number;
};

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} health probe timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a probe and reports up/down with the observed latency.
 *
 * Failure details are handed to `onFailure` for server-side logging and deliberately kept out of
 * the returned value: `/health` is typically unauthenticated, so it must not describe internals.
 */
export async function measureDependencyHealth(
  probe: DependencyProbe,
  onFailure?: (error: unknown) => void,
): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    await withTimeout(probe.check(), probe.timeoutMs ?? config.health.probeTimeoutMs, probe.name);
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    onFailure?.(error);
    return { status: "down", latencyMs: Math.round(performance.now() - startedAt) };
  }
}
