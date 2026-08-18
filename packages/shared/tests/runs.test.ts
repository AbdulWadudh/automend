import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import {
  buildRetriggerIdempotencyKey,
  buildRunIdempotencyKey,
  canTransitionRun,
  canTransitionStep,
  formatDurationMs,
  isTerminalRunStatus,
  isTerminalStepStatus,
  RUN_STATUSES,
  type RunStatus,
  runDurationMs,
  STEP_STATUSES,
  type StepStatus,
} from "../src/runs";

/**
 * The state machine is what makes a retry safe. A run that can go from `succeeded` back to `running`, or a
 * step that can be marked `skipped` after it has already sent an email, is a bug no column type catches —
 * so the rules are enumerated here rather than sampled.
 */

describe("a run's life", () => {
  test("it starts where the database puts it", () => {
    expect(RUN_STATUSES).toContain(config.runs.initialStatus);
  });

  test("a queued run can start, be cancelled, time out, or fail before it ever runs", () => {
    expect(canTransitionRun("pending", "running")).toBe(true);
    // A flow deleted before the worker collected the job, and a job that sat past its deadline.
    expect(canTransitionRun("pending", "cancelled")).toBe(true);
    expect(canTransitionRun("pending", "timedOut")).toBe(true);
    expect(canTransitionRun("pending", "failed")).toBe(true);
  });

  test("a running run can reach any outcome", () => {
    for (const outcome of config.runs.terminalStatuses) {
      expect(canTransitionRun("running", outcome)).toBe(true);
    }
  });

  test("it cannot go backwards", () => {
    expect(canTransitionRun("running", "pending")).toBe(false);
    expect(canTransitionRun("succeeded", "running")).toBe(false);
    expect(canTransitionRun("failed", "pending")).toBe(false);
  });

  test("nothing leads out of a finished run, which is what a retry relies on", () => {
    for (const from of config.runs.terminalStatuses) {
      for (const to of RUN_STATUSES) {
        expect(canTransitionRun(from, to)).toBe(false);
      }
    }
  });

  test("a run never transitions to itself, so a duplicate write is refused rather than silent", () => {
    for (const status of RUN_STATUSES) {
      expect(canTransitionRun(status, status)).toBe(false);
    }
  });

  test("every status is reachable from somewhere except the one runs start in", () => {
    for (const target of RUN_STATUSES) {
      if (target === config.runs.initialStatus) {
        continue;
      }

      const reachable = RUN_STATUSES.some((from: RunStatus) => canTransitionRun(from, target));

      expect(reachable).toBe(true);
    }
  });

  test("terminality agrees with the configured list", () => {
    for (const status of RUN_STATUSES) {
      const expected: readonly string[] = config.runs.terminalStatuses;

      expect(isTerminalRunStatus(status)).toBe(expected.includes(status));
    }
  });
});

describe("a step's life", () => {
  /**
   * A step may be skipped before it starts — the walk never reached it, because something earlier failed and
   * the author did not ask to continue. It may not be skipped once it has started, because a step that has
   * acted on the world cannot be un-acted.
   */
  test("it can be skipped before it starts but not after", () => {
    expect(canTransitionStep("pending", "skipped")).toBe(true);
    expect(canTransitionStep("running", "skipped")).toBe(false);
  });

  test("it can only succeed by having run", () => {
    expect(canTransitionStep("running", "succeeded")).toBe(true);
    expect(canTransitionStep("pending", "succeeded")).toBe(false);
  });

  test("nothing leads out of a finished step", () => {
    for (const from of config.runs.terminalStepStatuses) {
      for (const to of STEP_STATUSES) {
        expect(canTransitionStep(from, to)).toBe(false);
      }
    }
  });

  test("terminality agrees with the configured list", () => {
    for (const status of STEP_STATUSES) {
      const expected: readonly string[] = config.runs.terminalStepStatuses;

      expect(isTerminalStepStatus(status)).toBe(expected.includes(status));
    }
  });

  test("a step cannot transition to itself", () => {
    for (const status of STEP_STATUSES) {
      expect(canTransitionStep(status, status)).toBe(false);
    }
  });
});

/**
 * The key is what decides whether two attempts are the same run, so it has to be derived from what happened
 * rather than generated when it is noticed.
 */
describe("the run idempotency key", () => {
  test("the same external event produces the same key", () => {
    expect(buildRunIdempotencyKey("webhook", "delivery-1")).toBe(buildRunIdempotencyKey("webhook", "delivery-1"));
  });

  test("different events do not collide", () => {
    expect(buildRunIdempotencyKey("webhook", "a")).not.toBe(buildRunIdempotencyKey("webhook", "b"));
  });

  /** A webhook delivery and a polled item could otherwise collide on a bare upstream id. */
  test("the same id from two sources does not collide", () => {
    expect(buildRunIdempotencyKey("webhook", "1")).not.toBe(buildRunIdempotencyKey("polling", "1"));
  });

  test("every source produces a key within the column's bounds", () => {
    for (const source of config.runs.sources) {
      const key = buildRunIdempotencyKey(source, "x".repeat(64));

      expect(key.length).toBeLessThanOrEqual(config.validation.idempotencyKey.maxLength);
      expect(key.length).toBeGreaterThanOrEqual(config.validation.idempotencyKey.minLength);
    }
  });
});

/**
 * A run's source is the strategy of the trigger that produced it, so the two lists are one list seen from
 * two ends. Writing them separately would let a run exist whose source no trigger could have caused.
 */
describe("sources and trigger strategies", () => {
  test("are the same set", () => {
    expect([...config.runs.sources].toSorted()).toEqual([...config.kits.triggerStrategies].toSorted());
  });
});

describe("the status vocabularies", () => {
  test("do not repeat an entry", () => {
    expect(new Set(RUN_STATUSES).size).toBe(RUN_STATUSES.length);
    expect(new Set(STEP_STATUSES).size).toBe(STEP_STATUSES.length);
  });

  test("every terminal status is a real status", () => {
    const runStatuses: readonly string[] = RUN_STATUSES;
    const stepStatuses: readonly string[] = STEP_STATUSES;

    for (const status of config.runs.terminalStatuses) {
      expect(runStatuses).toContain(status);
    }

    for (const status of config.runs.terminalStepStatuses) {
      expect(stepStatuses).toContain(status);
    }
  });

  test("a run has at least one non-terminal status to sit in", () => {
    const nonTerminal = RUN_STATUSES.filter((status: RunStatus) => !isTerminalRunStatus(status));
    const nonTerminalSteps = STEP_STATUSES.filter((status: StepStatus) => !isTerminalStepStatus(status));

    expect(nonTerminal.length).toBeGreaterThan(0);
    expect(nonTerminalSteps.length).toBeGreaterThan(0);
  });
});

describe("how long a run took", () => {
  const startedAt = "2026-08-19T10:00:00.000Z";

  test("a queued run has no duration at all", () => {
    expect(runDurationMs({ startedAt: null, finishedAt: null })).toBeNull();
  });

  test("a finished run is measured between its own two timestamps", () => {
    expect(runDurationMs({ startedAt, finishedAt: "2026-08-19T10:00:01.500Z" })).toBe(1_500);
  });

  test("a running one is measured against now, so the page shows it climbing", () => {
    const nowMs = Date.parse(startedAt) + 4_000;

    expect(runDurationMs({ startedAt, finishedAt: null }, nowMs)).toBe(4_000);
  });

  test("a clock that went backwards reads as zero rather than as a negative duration", () => {
    expect(runDurationMs({ startedAt, finishedAt: "2026-08-19T09:59:59.000Z" })).toBe(0);
  });
});

describe("writing a duration down", () => {
  test("sub-second work keeps its milliseconds", () => {
    expect(formatDurationMs(350)).toBe("350ms");
  });

  test("seconds are precise enough to compare two fast steps", () => {
    expect(formatDurationMs(1_500)).toBe("1.50s");
    expect(formatDurationMs(42_300)).toBe("42.3s");
  });

  test("past a minute the milliseconds stop mattering", () => {
    expect(formatDurationMs(90_000)).toBe("1m 30s");
    expect(formatDurationMs(3 * 60 * 60 * 1_000 + 25 * 60 * 1_000)).toBe("3h 25m");
  });
});

describe("retriggering a run", () => {
  const runId = "9a1f8c2e-1111-4111-8111-111111111111";

  test("one gesture is one key, so a double-click resolves to the run it already started", () => {
    expect(buildRetriggerIdempotencyKey(runId, "press-1")).toBe(buildRetriggerIdempotencyKey(runId, "press-1"));
  });

  test("a later press carries a new token and is a genuinely new run", () => {
    expect(buildRetriggerIdempotencyKey(runId, "press-2")).not.toBe(buildRetriggerIdempotencyKey(runId, "press-1"));
  });

  test("two runs cannot collide even if their tokens match", () => {
    const other = "9a1f8c2e-2222-4222-8222-222222222222";

    expect(buildRetriggerIdempotencyKey(runId, "press-1")).not.toBe(buildRetriggerIdempotencyKey(other, "press-1"));
  });
});
