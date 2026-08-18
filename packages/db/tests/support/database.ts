import { createDefaultFlowDefinition, type FlowDefinition } from "@automend/shared";
import { eq } from "drizzle-orm";
import { createDatabaseClient, type Database } from "../../src/client";
import { flows, organization } from "../../src/schema";

/**
 * A real Postgres, or nothing.
 *
 * The guarantees these tests exist to check — `ON CONFLICT` deciding a race, `xmax` distinguishing an insert
 * from a conflict, `FOR UPDATE SKIP LOCKED` letting two relays work in parallel — are all *Postgres*
 * behaviour. A mocked Drizzle would assert that the code calls the functions it calls, which is worth
 * nothing here: the whole question is what the database does when two callers arrive together.
 *
 * So these skip rather than fake when no database is reachable. `bun run dev:up` provides one.
 */

export type TestDatabase = {
  db: Database;
  /** A workspace and a flow to hang rows off, removed with everything beneath them when the test ends. */
  tenantId: string;
  flowId: string;
  close: () => Promise<void>;
};

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;

  return url && url.length > 0 ? url : undefined;
}

/**
 * Asked of the domain rather than written out here, because `listFlowsForTenant` runs every stored
 * definition through `upgradeFlowDefinition` on read — a hand-written stub is a row the flow queries
 * cannot read back.
 */
export function stubDefinition(): FlowDefinition {
  return createDefaultFlowDefinition();
}

export async function setupDatabase(): Promise<TestDatabase> {
  const url = databaseUrl();

  if (!url) {
    throw new Error("setupDatabase called without DATABASE_URL — guard with databaseUrl() first");
  }

  const client = createDatabaseClient({ databaseUrl: url, maxConnections: 5 });
  const suffix = crypto.randomUUID().slice(0, 8);

  const [workspace] = await client.db
    .insert(organization)
    .values({
      id: crypto.randomUUID(),
      name: `runs-test-${suffix}`,
      slug: `runs-test-${suffix}`,
      createdAt: new Date(),
    })
    .returning({ id: organization.id });

  if (!workspace) {
    throw new Error("Could not create the test workspace");
  }

  const [flow] = await client.db
    .insert(flows)
    .values({ tenantId: workspace.id, name: "Test flow", definition: stubDefinition() })
    .returning({ id: flows.id });

  if (!flow) {
    throw new Error("Could not create the test flow");
  }

  return {
    db: client.db,
    tenantId: workspace.id,
    flowId: flow.id,
    close: async () => {
      // Deleting the workspace cascades through flows, runs, step runs, outbox rows and stores — which is
      // itself worth exercising, because a workspace that cannot be deleted is a real bug.
      await client.db.delete(organization).where(eq(organization.id, workspace.id));
      await client.close();
    },
  };
}
