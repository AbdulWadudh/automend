/**
 * Runs the tests that need a real Postgres, against a throwaway one.
 *
 * `packages/db/tests` checks the two guarantees the platform cannot be wrong about — a retried trigger
 * produces one run, a retried job does not repeat a step's side effect — and both are decided by
 * `ON CONFLICT` and `FOR UPDATE SKIP LOCKED` *inside the database*. A mocked Drizzle would assert that
 * the code calls the functions it calls, which is worth nothing: the entire question is what Postgres
 * does when two callers arrive together.
 *
 * Those tests skip themselves when `DATABASE_URL` is unset, which keeps `bun test` usable with no
 * infrastructure — but a test that silently skips in CI is a test nobody is running. This gate is what
 * makes them actually execute, and it fails if they were skipped rather than passed.
 *
 * The image and credentials come from `config.localDev.postgres`, so the Postgres major version here can
 * never drift from the one developed and deployed against. That is why this is a script rather than a
 * `services:` block in the workflow, which could not read the config.
 */

import { config } from "../../packages/shared/src/config";
import { run, waitForPostgres } from "./docker";

const CONTAINER = "automend-verify-db-tests";
const READY_ATTEMPTS = 60;
/** The tests that need a database. Narrow, so the gate does not re-run the whole suite. */
const TEST_PATH = "packages/db/tests";

const { user, password, database, image, containerPort } = config.localDev.postgres;

/**
 * A port of its own, so a running `bun run dev:up` stack is neither disturbed nor accidentally used —
 * these tests create and delete workspaces, and doing that to a developer's own data would be rude at
 * best.
 */
const HOST_PORT = containerPort + 2;

async function removeContainer(): Promise<void> {
  await run(["docker", "rm", "-f", CONTAINER]);
}

async function startPostgres(): Promise<void> {
  await removeContainer();

  const started = await run([
    "docker",
    "run",
    "--detach",
    "--name",
    CONTAINER,
    "--publish",
    `${HOST_PORT}:${containerPort}`,
    "--env",
    `POSTGRES_USER=${user}`,
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    `POSTGRES_DB=${database}`,
    image,
  ]);

  if (!started.ok) {
    throw new Error(`could not start Postgres for the database tests\n\n${started.output}`);
  }

  if (!(await waitForPostgres(CONTAINER, user, database, READY_ATTEMPTS))) {
    throw new Error("Postgres did not become ready for the database tests");
  }
}

export async function runDatabaseTests(): Promise<void> {
  const databaseUrl = `postgres://${user}:${password}@localhost:${HOST_PORT}/${database}`;

  try {
    await startPostgres();

    const migrated = await run(["bun", "run", "db:migrate"], { env: { DATABASE_URL: databaseUrl } });

    if (!migrated.ok) {
      throw new Error(`migrations did not apply to a fresh database\n\n${migrated.output}`);
    }

    const tested = await run(["bun", "test", TEST_PATH], { env: { DATABASE_URL: databaseUrl } });

    if (!tested.ok) {
      throw new Error(`database tests failed\n\n${tested.output}`);
    }

    // The tests skip themselves when they see no `DATABASE_URL`, and a skipped suite exits 0 — so
    // passing is not enough to know they ran. Without this check the gate would go green having proven
    // nothing, which is the exact failure it exists to prevent.
    if (tested.output.includes("Skipping run persistence tests")) {
      throw new Error(`the database tests skipped themselves despite being given a database\n\n${tested.output}`);
    }

    if (!/[1-9]\d* pass/.test(tested.output)) {
      throw new Error(`the database tests reported no passing tests\n\n${tested.output}`);
    }
  } finally {
    await removeContainer();
  }
}
