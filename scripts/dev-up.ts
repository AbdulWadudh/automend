/**
 * Brings the local development environment up from nothing.
 *
 *   bun run dev:up                Docker engine + Postgres + Redis + migrations
 *   bun run dev:up --all          the same, plus the api, worker and web containers
 *   bun run dev:up --free-ports   terminate whatever holds the app ports, without asking
 *
 * Without `--all` the apps are left for you to run on the host with `bun run dev:api` and friends;
 * only their backing stores come up. That is the loop worth optimising, because rebuilding an
 * image on every code change is not one.
 *
 * Every step is a no-op when it is already done, so re-running is always safe.
 */

import { fileURLToPath } from "node:url";
// Imported by path rather than by package name: workspace packages are linked into each app's
// node_modules, not the repo root's, so a script living here cannot resolve "@automend/shared".
import { config } from "../packages/shared/src/config";
import { describeOwner, findPortOwner, freePort } from "./ports";

const { docker, hostPorts, postgres, redis } = config.localDev;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function step(message: string): void {
  console.log(`\n▸ ${message}`);
}

function fail(message: string, hint?: string): never {
  console.error(`\nFAILED: ${message}`);

  if (hint) {
    console.error(`  ↳ ${hint}`);
  }

  process.exit(1);
}

async function capture(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

  return { exitCode: await child.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Streams straight to this terminal — compose's progress output is the point of running it. */
async function forward(command: string[]): Promise<number> {
  const child = Bun.spawn(command, { cwd: repositoryRoot, stdout: "inherit", stderr: "inherit" });
  return await child.exited;
}

async function isEngineReady(): Promise<boolean> {
  try {
    const result = await capture(["docker", "version", "--format", "{{.Server.Version}}"]);
    return result.exitCode === 0 && result.stdout.length > 0;
  } catch {
    // `docker` missing from PATH throws rather than exiting non-zero.
    return false;
  }
}

function engineLauncher(): string[] | null {
  if (process.platform === "win32") {
    return [...docker.desktopLaunchers.win32];
  }

  if (process.platform === "darwin") {
    return [...docker.desktopLaunchers.darwin];
  }

  return null;
}

function launchEngine(): void {
  const launcher = engineLauncher();

  if (!launcher) {
    fail(
      "the Docker daemon is not running",
      "On Linux it is a system service, not something this script may start: `sudo systemctl start docker`",
    );
  }

  try {
    // Unreferenced so this script can exit later without waiting on Docker Desktop's own lifetime.
    Bun.spawn(launcher, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch (error) {
    fail(`could not launch Docker Desktop: ${describe(error)}`, `Tried: ${launcher.join(" ")}`);
  }
}

async function waitForEngine(): Promise<void> {
  const deadline = Date.now() + docker.engineReadyTimeoutMs;

  while (Date.now() < deadline) {
    await Bun.sleep(docker.enginePollIntervalMs);

    if (await isEngineReady()) {
      const remainingSeconds = Math.round((docker.engineReadyTimeoutMs - (deadline - Date.now())) / 1000);
      console.log(`  engine ready after ${remainingSeconds}s`);
      return;
    }

    process.stdout.write(".");
  }

  console.log("");
  fail(
    `the Docker engine did not become ready within ${docker.engineReadyTimeoutMs / 1000}s`,
    "Docker Desktop can wedge with its UI running but no engine. Quit it from the tray and relaunch; if that fails, `wsl --shutdown` first.",
  );
}

async function ensureEngine(): Promise<void> {
  step("Docker engine");

  if (await isEngineReady()) {
    console.log("  already running");
    return;
  }

  console.log("  not running — starting it");
  launchEngine();
  await waitForEngine();
}

async function ensureEnvFile(): Promise<void> {
  step("Environment file");

  if (await Bun.file(`${repositoryRoot}/.env`).exists()) {
    console.log("  .env present");
    return;
  }

  // Compose substitutes ${VAR} from .env. Without it every port and credential resolves to an
  // empty string and the failures that follow name none of this as the cause.
  fail("no .env at the repository root", "cp .env.example .env");
}

async function startServices(startEverything: boolean): Promise<void> {
  const services = startEverything ? [] : [...docker.dependencyServices];

  step(startEverything ? "Starting the whole stack" : `Starting ${services.join(" and ")}`);

  // `--wait` blocks on the healthchecks in docker-compose.yml, so this returns when the services
  // are actually accepting connections rather than when their containers merely exist.
  const command = ["docker", "compose", "up", "-d", "--wait", ...(startEverything ? ["--build"] : []), ...services];
  const exitCode = await forward(command);

  if (exitCode !== 0) {
    fail(`\`${command.join(" ")}\` exited ${exitCode}`);
  }
}

/** Reads the effective port, so a `.env` override is checked rather than the default beside it. */
function effectivePort(entry: (typeof hostPorts)[number]): number {
  const override = entry.envVar ? Number(process.env[entry.envVar]) : Number.NaN;
  return Number.isInteger(override) && override > 0 ? override : entry.defaultPort;
}

async function confirm(question: string): Promise<boolean> {
  // Piped or CI: never block waiting for an answer that cannot come.
  if (!process.stdin.isTTY) {
    return false;
  }

  process.stdout.write(`${question} [y/N] `);

  for await (const line of console) {
    return /^y(es)?$/i.test(line.trim());
  }

  return false;
}

async function ensurePortsFree(freeWithoutAsking: boolean): Promise<void> {
  step("Host ports");

  const conflicts = [];

  for (const entry of hostPorts) {
    const owner = await findPortOwner(effectivePort(entry));

    if (owner) {
      conflicts.push({ owner, label: entry.label });
    }
  }

  if (conflicts.length === 0) {
    console.log(`  ${hostPorts.map((entry) => effectivePort(entry)).join(", ")} all free`);
    return;
  }

  for (const { owner, label } of conflicts) {
    console.log(`  ${describeOwner(owner, label)}`);
  }

  // Naming the process before asking is the point: the holder is usually a dev server from an
  // earlier session, but it can just as easily be something unrelated that must not be killed.
  const shouldFree =
    freeWithoutAsking || (await confirm(`\n  Terminate ${conflicts.length === 1 ? "it" : "them"} and continue?`));

  if (!shouldFree) {
    fail(
      "the ports the apps need are in use",
      "Stop the processes above, re-run with `--free-ports`, or change the port in .env.",
    );
  }

  for (const { owner, label } of conflicts) {
    const freed = await freePort(owner);
    console.log(`  ${freed ? "freed" : "STILL HELD"} port ${owner.port} (${label})`);

    if (!freed) {
      fail(
        `pid ${owner.pid} did not release port ${owner.port}`,
        process.platform === "win32"
          ? `taskkill /F /PID ${owner.pid}`
          : `kill -9 ${owner.pid}  — it ignored SIGTERM, so it needs SIGKILL`,
      );
    }
  }
}

async function applyMigrations(): Promise<void> {
  step("Applying migrations");

  const exitCode = await forward(["bun", "run", "db:migrate"]);

  if (exitCode !== 0) {
    fail(`migrations exited ${exitCode}`, "Check DATABASE_URL in .env points at the local Postgres.");
  }
}

const startEverything = process.argv.includes("--all");
const freePortsWithoutAsking = process.argv.includes("--free-ports");

console.log("Automend — local development stack");

await ensureEnvFile();
await ensureEngine();
await startServices(startEverything);

// With `--all` the apps run in containers and publish their ports through Docker, which reports a
// conflict itself and would not be fixed by killing a host process.
if (!startEverything) {
  await ensurePortsFree(freePortsWithoutAsking);
}

// With `--all` the compose `migrate` service has already run them, and the api and worker waited
// for it before starting.
if (!startEverything) {
  await applyMigrations();
}

console.log("\nReady.");
console.log(`  Postgres  ${config.localDev.host}:${postgres.containerPort}`);
console.log(`  Redis     ${config.localDev.host}:${redis.containerPort}`);

if (startEverything) {
  console.log(`  Web       http://${config.localDev.host}:${config.services.web.defaultPort}`);
  console.log(`  API       http://${config.localDev.host}:${config.services.api.defaultPort}`);
} else {
  console.log("\nNow run the apps on the host:");
  console.log("  bun run dev:api");
  console.log("  bun run dev:worker");
  console.log("  bun run dev:web");
}
