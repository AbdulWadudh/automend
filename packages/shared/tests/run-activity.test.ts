import { describe, expect, test } from "bun:test";
import { hasRunInFlight, type RunStatusGroup, summariseRunGroups } from "../src/run-activity";
import { RUN_STATUSES } from "../src/runs";

const WINDOW = { windowHours: 24, since: "2026-08-18T00:00:00.000Z" };

function group(overrides: Partial<RunStatusGroup> = {}): RunStatusGroup {
  return {
    flowId: "11111111-1111-4111-8111-111111111111",
    flowName: "Order intake",
    status: "succeeded",
    runCount: 1,
    finishedCount: 1,
    totalDurationMs: 1_000,
    longestDurationMs: 1_000,
    lastRunAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("summarising runs", () => {
  test("every status is present so a caller never checks for undefined", () => {
    const stats = summariseRunGroups([], WINDOW);

    for (const status of RUN_STATUSES) {
      expect(stats.totals.byStatus[status]).toBe(0);
    }

    expect(stats.totals.total).toBe(0);
    expect(stats.flows).toEqual([]);
  });

  test("a flow's groups roll up into one row", () => {
    const stats = summariseRunGroups(
      [
        group({ status: "succeeded", runCount: 3, finishedCount: 3, totalDurationMs: 3_000 }),
        group({ status: "failed", runCount: 1, finishedCount: 1, totalDurationMs: 500, longestDurationMs: 500 }),
      ],
      WINDOW,
    );

    expect(stats.flows).toHaveLength(1);
    expect(stats.flows[0]?.total).toBe(4);
    expect(stats.flows[0]?.byStatus.succeeded).toBe(3);
    expect(stats.flows[0]?.byStatus.failed).toBe(1);
    expect(stats.totals.total).toBe(4);
  });

  /**
   * The reason the query returns a sum and a count rather than an average: averaging the averages
   * would weigh one quick cancellation as heavily as three slow successes.
   */
  test("averages are weighted by how many runs each group finished", () => {
    const stats = summariseRunGroups(
      [
        group({ status: "succeeded", runCount: 3, finishedCount: 3, totalDurationMs: 30_000 }),
        group({ status: "cancelled", runCount: 1, finishedCount: 1, totalDurationMs: 2_000 }),
      ],
      WINDOW,
    );

    expect(stats.totals.averageDurationMs).toBe(8_000);
    expect(stats.flows[0]?.averageDurationMs).toBe(8_000);
  });

  test("runs that never finished are left out of the average rather than counted as instant", () => {
    const stats = summariseRunGroups(
      [group({ status: "running", runCount: 5, finishedCount: 0, totalDurationMs: 0, longestDurationMs: null })],
      WINDOW,
    );

    expect(stats.totals.total).toBe(5);
    expect(stats.totals.averageDurationMs).toBeNull();
    expect(stats.totals.longestDurationMs).toBeNull();
  });

  test("the longest run is the longest across every group", () => {
    const stats = summariseRunGroups(
      [group({ status: "succeeded", longestDurationMs: 4_000 }), group({ status: "failed", longestDurationMs: 9_000 })],
      WINDOW,
    );

    expect(stats.totals.longestDurationMs).toBe(9_000);
    expect(stats.flows[0]?.longestDurationMs).toBe(9_000);
  });

  test("the most recent run wins, whichever group it came from", () => {
    const stats = summariseRunGroups(
      [
        group({ status: "succeeded", lastRunAt: "2026-08-19T09:00:00.000Z" }),
        group({ status: "failed", lastRunAt: "2026-08-19T11:30:00.000Z" }),
      ],
      WINDOW,
    );

    expect(stats.flows[0]?.lastRunAt).toBe("2026-08-19T11:30:00.000Z");
  });

  test("flows are ordered by how busy they are, with the name breaking ties", () => {
    const stats = summariseRunGroups(
      [
        group({ flowId: "22222222-2222-4222-8222-222222222222", flowName: "Zebra", runCount: 1 }),
        group({ flowId: "33333333-3333-4333-8333-333333333333", flowName: "Alpha", runCount: 1 }),
        group({ flowId: "44444444-4444-4444-8444-444444444444", flowName: "Busy", runCount: 9 }),
      ],
      WINDOW,
    );

    expect(stats.flows.map((flow) => flow.flowName)).toEqual(["Busy", "Alpha", "Zebra"]);
  });

  /** A status this build does not know still counts towards the total; it just has no bucket to sit in. */
  test("an unknown status does not break the summary", () => {
    const stats = summariseRunGroups([group({ status: "abducted", runCount: 2 })], WINDOW);

    expect(stats.totals.total).toBe(2);
    expect(stats.flows[0]?.total).toBe(2);
  });

  test("the window it counted is echoed back", () => {
    const stats = summariseRunGroups([], WINDOW);

    expect(stats.windowHours).toBe(WINDOW.windowHours);
    expect(stats.since).toBe(WINDOW.since);
  });
});

describe("deciding whether to keep polling", () => {
  test("a page of finished runs is not polled", () => {
    expect(hasRunInFlight([{ status: "succeeded" }, { status: "failed" }, { status: "cancelled" }])).toBe(false);
  });

  test("one unfinished run is enough", () => {
    expect(hasRunInFlight([{ status: "succeeded" }, { status: "running" }])).toBe(true);
    expect(hasRunInFlight([{ status: "pending" }])).toBe(true);
  });

  test("nothing on screen is nothing to poll for", () => {
    expect(hasRunInFlight([])).toBe(false);
  });
});
