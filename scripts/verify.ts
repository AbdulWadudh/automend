/**
 * Runs, locally, everything a deployment would discover for you.
 *
 * `preflight.ts` answers "is this environment alive". This answers the question that came before
 * it: "would deploying this branch work at all". Every gate below is something that has failed in
 * Coolify rather than on a laptop, which is the expensive order to find out:
 *
 * - a workspace package no Dockerfile copied, so `bun install --frozen-lockfile` rejected the
 *   lockfile in all three images
 * - a required variable no compose file passed, so the api exited during env validation
 * - a colon inside a `${VAR:?message}` default, which is not valid unquoted YAML
 * - a migration that applies to an empty database and not to a populated one
 *
 *   bun run verify           every gate
 *   bun run verify --fast    skips the ones that need Docker images built
 *
 * Stops at the first failure: the first thing that breaks is the thing to fix, and the gates after
 * it take minutes.
 */

import { config } from "../packages/shared/src/config";
import { isDockerRunning, run } from "./verify/docker";
import { replayMigrations } from "./verify/migration-replay";

const COMPOSE_FILES = ["docker-compose.yml", "deploy/coolify/docker-compose.yml"];
const IMAGE_TAG_PREFIX = "automend-verify";
/** What a deploy of this branch would land on. Overridable, because not every branch targets main. */
const DEFAULT_REFERENCE_REF = "origin/main";

const buildableApps = [config.services.api, config.services.worker, config.services.web];

type Gate = {
  name: string;
  /** Needs Docker images, so `--fast` leaves it out. */
  slow?: boolean;
  run: () => Promise<void>;
};

function imageTagFor(appName: string): string {
  return `${IMAGE_TAG_PREFIX}-${appName}`;
}

async function expectSuccess(description: string, command: string[]): Promise<void> {
  const { ok, output } = await run(command);

  if (!ok) {
    throw new Error(`${description}\n\n${output}`);
  }
}

/**
 * Substitution is what fails here, not the schema: an unset required variable and a value that is
 * not valid YAML both surface as a `config` error, and both stop a deploy.
 *
 * Every variable is given a placeholder so the gate reports genuine problems rather than the
 * absence of a production environment. `SECRETS_KEY` must still decode to 32 bytes.
 */
async function checkComposeFiles(): Promise<void> {
  const placeholders = {
    SECRETS_KEY: Buffer.alloc(config.secrets.keyLengthBytes, "v").toString("base64"),
    AUTH_SECRET: "v".repeat(config.auth.secretMinLength),
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
    PUBLIC_WEB_URL: "https://web.invalid",
    SERVICE_PASSWORD_64_AUTH: "v".repeat(config.auth.secretMinLength),
    SERVICE_USER_POSTGRES: config.localDev.postgres.user,
    SERVICE_PASSWORD_POSTGRES: config.localDev.postgres.password,
    SERVICE_PASSWORD_REDIS: config.localDev.postgres.password,
  };

  for (const composeFile of COMPOSE_FILES) {
    const { ok, output } = await run(["docker", "compose", "-f", composeFile, "config"], { env: placeholders });

    if (!ok) {
      throw new Error(`${composeFile} does not resolve\n\n${output}`);
    }
  }
}

const gates: Gate[] = [
  { name: "formatting and lint", run: () => expectSuccess("biome found problems", ["bun", "run", "check"]) },
  { name: "types", run: () => expectSuccess("typecheck failed", ["bun", "run", "typecheck"]) },
  { name: "tests", run: () => expectSuccess("tests failed", ["bun", "test"]) },
  {
    name: ".env.example matches config",
    run: () => expectSuccess("run `bun run config:sync`", ["bun", "run", "config:check"]),
  },
  {
    name: "generated auth schema is current",
    run: () => expectSuccess("run `bun run auth:schema`", ["bun", "run", "auth:schema:check"]),
  },
  { name: "compose files resolve", run: checkComposeFiles },
  {
    name: "container images build",
    slow: true,
    run: async () => {
      for (const app of buildableApps) {
        await expectSuccess(`the ${app.name} image does not build`, [
          "docker",
          "build",
          "-f",
          `apps/${app.name}/Dockerfile`,
          "-t",
          imageTagFor(app.name),
          ".",
        ]);
      }
    },
  },
  {
    name: "migrations apply to a populated database",
    slow: true,
    run: () =>
      replayMigrations({
        referenceRef: process.env.VERIFY_REFERENCE_REF ?? DEFAULT_REFERENCE_REF,
        apiImageTag: imageTagFor(config.services.api.name),
      }),
  },
];

async function main(): Promise<void> {
  const fast = process.argv.includes("--fast");
  const selected = fast ? gates.filter((gate) => !gate.slow) : gates;

  if (!fast && !(await isDockerRunning())) {
    console.error("Docker is not running, and the image and migration gates need it.");
    console.error("Start Docker, or run `bun run verify --fast` to skip them.");
    process.exit(1);
  }

  console.log(`verifying ${selected.length} of ${gates.length} gates${fast ? " (--fast)" : ""}\n`);

  for (const [index, gate] of selected.entries()) {
    const startedAt = Bun.nanoseconds();
    process.stdout.write(`  ${index + 1}/${selected.length}  ${gate.name} ... `);

    try {
      await gate.run();
    } catch (error) {
      console.log("FAILED\n");
      console.error((error as Error).message);
      process.exit(1);
    }

    console.log(`ok (${Math.round((Bun.nanoseconds() - startedAt) / 1_000_000)}ms)`);
  }

  console.log(fast ? "\nfast gates passed — run without --fast before deploying" : "\nall gates passed");
}

await main();
