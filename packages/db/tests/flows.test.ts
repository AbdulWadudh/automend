import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertFlow, listFlowsForTenant } from "../src/flows";
import { databaseUrl, setupDatabase, stubDefinition, type TestDatabase } from "./support/database";

const hasDatabase = databaseUrl() !== undefined;
const describeWithDatabase = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn("Skipping flow search tests: DATABASE_URL is not set. Run `bun run dev:up` for a database.");
}

describeWithDatabase("searching a workspace's flows", () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await setupDatabase();

    for (const name of ["Order intake", "ORDER refunds", "Nightly report", "100% uptime check"]) {
      await insertFlow(context.db, {
        tenantId: context.tenantId,
        name,
        definition: stubDefinition(),
        createdBy: null,
      });
    }
  });

  afterAll(async () => {
    await context?.close();
  });

  async function search(term: string) {
    const rows = await listFlowsForTenant(context.db, context.tenantId, { search: term });

    return rows.map((row) => row.name);
  }

  test("no search returns everything, as the flows page has always asked for", async () => {
    const all = await listFlowsForTenant(context.db, context.tenantId);

    // The workspace's own "Test flow" comes with the fixture, so four inserts make five.
    expect(all).toHaveLength(5);
  });

  test("it matches anywhere in the name, whatever the case", async () => {
    const found = await search("order");

    expect(found.sort()).toEqual(["ORDER refunds", "Order intake"]);
  });

  /** `%` is a wildcard to `ilike`, so an unescaped one would match every flow in the workspace. */
  test("a percent sign in the search is a percent sign, not a wildcard", async () => {
    expect(await search("100%")).toEqual(["100% uptime check"]);
    expect(await search("%")).toEqual(["100% uptime check"]);
  });

  /** `_` matches any single character, which would quietly turn a typo into a wider search. */
  test("an underscore in the search is an underscore", async () => {
    expect(await search("Order_intake")).toEqual([]);
  });

  /** The listing carries it so the flows page can say when a flow last did anything. */
  test("a flow that has never run reports no last run", async () => {
    const rows = await listFlowsForTenant(context.db, context.tenantId);

    expect(rows.every((row) => row.lastRunAt === null)).toBe(true);
  });

  test("the limit bounds what comes back", async () => {
    const limited = await listFlowsForTenant(context.db, context.tenantId, { limit: 2 });

    expect(limited).toHaveLength(2);
  });

  test("another workspace's flows are never matched", async () => {
    const stranger = await setupDatabase();

    try {
      const found = await listFlowsForTenant(stranger.db, stranger.tenantId, { search: "Order" });

      expect(found).toEqual([]);
    } finally {
      await stranger.close();
    }
  });
});
