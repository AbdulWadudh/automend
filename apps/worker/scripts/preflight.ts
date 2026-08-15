/**
 * Checks that a deployment's environment actually works, before or after deploying the apps.
 *
 * Every check here is something that has silently broken a deployment at least once:
 *
 * - Postgres reachable with the configured credentials
 * - Redis reachable
 * - **BullMQ's Lua scripts run** — the one that matters when the Redis server is Dragonfly, which
 *   refuses undeclared-key Lua access unless started with hashtag locking. Without it every other
 *   check passes while job processing is completely broken.
 * - The OTLP collector accepts a log record
 *
 *   bun run preflight
 *
 * Lives in the worker because that is the app which already depends on all three. Reads exactly
 * the variables the services read, so run it with the target deployment's environment loaded.
 * Exits non-zero if any check fails.
 */

import { createDatabaseClient, pingDatabase } from "@automend/db";
import { config } from "@automend/shared";
import { loadApiEnv } from "@automend/shared/env";
import { buildOtlpLogsUrl } from "@automend/shared/telemetry";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const PREFLIGHT_QUEUE = "{automend-preflight}";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
};

const results: CheckResult[] = [];

function record(result: CheckResult): void {
  results.push(result);
  console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.name} — ${result.detail}`);

  if (!result.ok && result.hint) {
    console.log(`       ↳ ${result.hint}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const env = loadApiEnv();

console.log("Automend preflight\n");

// --- Postgres --------------------------------------------------------------
try {
  const database = createDatabaseClient({ databaseUrl: env.DATABASE_URL, maxConnections: 1 });

  try {
    await pingDatabase(database.db);
    record({ name: "postgres", ok: true, detail: "reachable" });
  } finally {
    await database.close();
  }
} catch (error) {
  record({
    name: "postgres",
    ok: false,
    detail: describe(error),
    hint: "Inside Coolify use the database's internal URL, not the public one.",
  });
}

// --- Redis / Dragonfly -----------------------------------------------------
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 15_000 });
// Reconnect failures surface through the checks themselves; an unhandled 'error' would abort.
redis.on("error", () => {});

let redisReachable = false;

try {
  await redis.ping();
  redisReachable = true;
  record({ name: "redis", ok: true, detail: "reachable" });

  const dragonflyVersion = /dragonfly_version:(.*)/.exec(await redis.info("server"))?.[1]?.trim();

  if (dragonflyVersion) {
    console.log(`       server is Dragonfly ${dragonflyVersion}`);
  }
} catch (error) {
  record({
    name: "redis",
    ok: false,
    detail: describe(error),
    hint: "Check the password, and that the app can route to the host.",
  });
}

// --- BullMQ on this server -------------------------------------------------
if (redisReachable) {
  const queue = new Queue(PREFLIGHT_QUEUE, { connection: redis });

  try {
    const job = await queue.add("preflight", { check: "lua-undeclared-keys" });
    await queue.obliterate({ force: true });
    record({ name: "bullmq", ok: true, detail: `enqueue + cleanup succeeded (job ${job.id})` });
  } catch (error) {
    const message = describe(error);
    record({
      name: "bullmq",
      ok: false,
      detail: message,
      hint: /undeclared|lua|script|cluster/i.test(message)
        ? "Set DFLY_cluster_mode=emulated and DFLY_lock_on_hashtags=true on the Dragonfly service."
        : undefined,
    });
  } finally {
    await queue.close().catch(() => {});
  }
}

await redis.quit().catch(() => {});

// --- Telemetry -------------------------------------------------------------
if (env.OTEL_LOGS_ENABLED) {
  const logsUrl = buildOtlpLogsUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT);

  const logRecord = {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "automend-preflight" } }],
        },
        scopeLogs: [
          {
            scope: { name: "automend-preflight" },
            logRecords: [
              {
                timeUnixNano: String(Date.now() * 1_000_000),
                severityNumber: 9,
                severityText: "info",
                body: { stringValue: "automend preflight check" },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(logsUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...env.OTEL_EXPORTER_OTLP_HEADERS },
      body: JSON.stringify(logRecord),
    });

    record({
      name: "telemetry",
      ok: response.ok,
      detail: `${logsUrl} → HTTP ${response.status}`,
      hint: response.ok ? undefined : "Endpoint is the collector base URL, without /v1/logs.",
    });
  } catch (error) {
    record({ name: "telemetry", ok: false, detail: describe(error) });
  }
} else {
  console.log("[SKIP] telemetry — OTEL_LOGS_ENABLED is false");
}

// --- Summary ---------------------------------------------------------------
const failed = results.filter((result) => !result.ok);

console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.error(`FAILED: ${failed.map((result) => result.name).join(", ")}`);
  process.exit(1);
}

console.log(`Deployment looks good. Execution queue: ${config.queue.flowExecutions.name}`);
