/**
 * Applies a reference release's migrations to a throwaway Postgres, puts rows in it, then applies
 * the working tree's — the deploy this branch would actually perform.
 *
 * A migration is normally only ever tested against an empty local database, where
 * `ADD COLUMN ... NOT NULL` with no default and a foreign key to a table that did not exist yet
 * both succeed. Against a populated one they do not. That gap is what this closes.
 *
 * Needs Docker and the api image, because the migration runner that matters is the one shipped in
 * the image, resolving its folder the way it will in production.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// Relative, not "@automend/shared": bun resolves a workspace name from the importing package's
// node_modules, and scripts/ is not a package. See the same note in scripts/dev-up.ts.
import { config } from "../../packages/shared/src/config";
import { run, waitForPostgres } from "./docker";
import { seedEveryTable } from "./seed-schema";

const CONTAINER = "automend-verify-postgres";
const MIGRATIONS_PATH = "packages/db/migrations";
/** Where the api image keeps them, so a mount can stand in for the image's own copy. */
const IMAGE_MIGRATIONS_PATH = "/app/packages/db/migrations";
const IMAGE_MIGRATE_SCRIPT = "/app/packages/db/src/migrate.ts";
const READY_ATTEMPTS = 60;

const { user, password, database, image, containerPort } = config.localDev.postgres;

export type ReplayOptions = {
  /** The release being deployed over. Its migrations are applied first. */
  referenceRef: string;
  apiImageTag: string;
};

type ReferenceMigrations = {
  /** The folder to mount, holding only the reference release's SQL. */
  migrationsDirectory: string;
  /** Deleted afterwards; the mounted folder is nested inside it. */
  temporaryRoot: string;
};

async function startPostgres(): Promise<void> {
  await run(["docker", "rm", "-f", CONTAINER]);

  const started = await run([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    `POSTGRES_USER=${user}`,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    `POSTGRES_DB=${database}`,
    image,
  ]);

  if (!started.ok) {
    throw new Error(`could not start Postgres for the replay:\n${started.output}`);
  }

  if (!(await waitForPostgres(CONTAINER, user, database, READY_ATTEMPTS))) {
    throw new Error(`Postgres did not become ready within ${READY_ATTEMPTS} attempts`);
  }
}

/**
 * The reference migrations, written somewhere a container can mount.
 *
 * Each file is read with `git show` rather than unpacked from `git archive`: tar on Windows reads a
 * `C:\...` destination as a remote `host:path` and refuses it. This also writes outside the
 * repository, so verifying a branch never disturbs the working tree being verified.
 */
async function extractReferenceMigrations(referenceRef: string): Promise<ReferenceMigrations | undefined> {
  const listed = await run(["git", "ls-tree", "-r", "--name-only", `${referenceRef}:${MIGRATIONS_PATH}`]);

  if (!listed.ok) {
    return undefined;
  }

  const files = listed.output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (files.length === 0) {
    return undefined;
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "automend-replay-"));
  const migrationsDirectory = join(temporaryRoot, "migrations");

  for (const file of files) {
    const shown = await run(["git", "show", `${referenceRef}:${MIGRATIONS_PATH}/${file}`]);

    if (!shown.ok) {
      throw new Error(`could not read ${file} at ${referenceRef}:
${shown.output}`);
    }

    const destination = join(migrationsDirectory, file);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, shown.output);
  }

  return { migrationsDirectory, temporaryRoot };
}

async function migrate(apiImageTag: string, mountedMigrations?: string) {
  return run([
    "docker",
    "run",
    "--rm",
    "--network",
    `container:${CONTAINER}`,
    ...(mountedMigrations ? ["-v", `${mountedMigrations}:${IMAGE_MIGRATIONS_PATH}:ro`] : []),
    "-e",
    `DATABASE_URL=postgres://${user}:${password}@127.0.0.1:${containerPort}/${database}`,
    "--entrypoint",
    "bun",
    apiImageTag,
    "run",
    IMAGE_MIGRATE_SCRIPT,
  ]);
}

/**
 * The migration files this branch adds. An empty list means a deploy would apply nothing, so there
 * is no point starting a database to prove it.
 */
async function migrationsAddedSince(referenceRef: string): Promise<string[]> {
  const listed = await run(["git", "ls-tree", "-r", "--name-only", `${referenceRef}:${MIGRATIONS_PATH}`]);
  const reference = new Set(listed.ok ? listed.output.split("\n").map((line) => line.trim()) : []);
  const current = new Bun.Glob("*.sql").scanSync({ cwd: resolve(import.meta.dir, "../..", MIGRATIONS_PATH) });

  return [...current].filter((file) => !reference.has(file)).sort();
}

function describeSkipped(skipped: { table: string; reason: string }[]): string {
  return skipped.map(({ table, reason }) => `  ${table}: ${reason}`).join("\n");
}

export async function replayMigrations({ referenceRef, apiImageTag }: ReplayOptions): Promise<void> {
  const reference = await extractReferenceMigrations(referenceRef);

  if (!reference) {
    console.log(`    no ${MIGRATIONS_PATH} at ${referenceRef} — nothing to deploy over, skipped`);
    return;
  }

  const newMigrations = await migrationsAddedSince(referenceRef);

  if (newMigrations.length === 0) {
    console.log(`    no migration added since ${referenceRef} — nothing new to apply, skipped`);
    await rm(reference.temporaryRoot, { recursive: true, force: true });
    return;
  }

  console.log(
    `    ${newMigrations.length} new migration${newMigrations.length === 1 ? "" : "s"}: ${newMigrations.join(", ")}`,
  );

  await startPostgres();

  try {
    const referenceRun = await migrate(apiImageTag, reference.migrationsDirectory);

    if (!referenceRun.ok) {
      throw new Error(
        `the reference release's own migrations failed, so there is nothing to deploy over:\n${referenceRun.output}`,
      );
    }

    const seed = await seedEveryTable({ container: CONTAINER, user, database });

    if (seed.seeded.length === 0) {
      throw new Error(
        `no table could be given a row, so the replay would run against an empty database and prove nothing:\n${describeSkipped(seed.skipped)}`,
      );
    }

    for (const { table, reason } of seed.skipped) {
      console.log(`    ${table} left empty: ${reason}`);
    }

    console.log(`    applied ${referenceRef}, seeded ${seed.seeded.length} tables, now applying this branch`);

    const currentRun = await migrate(apiImageTag);

    if (!currentRun.ok) {
      throw new Error(
        `this branch's migrations do not apply to a populated ${referenceRef} database:\n${currentRun.output}`,
      );
    }
  } finally {
    await run(["docker", "rm", "-f", CONTAINER]);
    await rm(reference.temporaryRoot, { recursive: true, force: true });
  }
}
