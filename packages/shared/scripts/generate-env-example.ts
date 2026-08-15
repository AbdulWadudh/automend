/**
 * Regenerates `.env.example` from `packages/shared/src/config.ts`.
 *
 * `.env.example` is the input to both `cp .env.example .env` and `docker-compose.yml`'s variable
 * substitution, so generating it is what stops ports and credentials being written down twice.
 *
 *   bun run config:sync     rewrite .env.example
 *   bun run config:check    fail if it is out of date (use in CI)
 */

import { fileURLToPath } from "node:url";
import { config } from "../src/config";

type EnvSection = {
  title: string;
  note?: string;
  entries: Array<[name: string, value: string | number, comment?: string]>;
};

const { localDev, services, env, http, telemetry } = config;

const sections: EnvSection[] = [
  {
    title: "Shared",
    entries: [
      ["NODE_ENV", env.defaultNodeEnv],
      ["LOG_LEVEL", env.defaultLogLevel],
    ],
  },
  {
    title: "Local development stack (docker-compose only)",
    note: "Throwaway local credentials, not secrets. Compose builds its own in-network URLs from these.",
    entries: [
      ["POSTGRES_IMAGE", localDev.postgres.image, "Keep the major version in step with production."],
      ["POSTGRES_USER", localDev.postgres.user],
      ["POSTGRES_PASSWORD", localDev.postgres.password],
      ["POSTGRES_DB", localDev.postgres.database],
      ["POSTGRES_PORT", localDev.postgres.containerPort],
      [
        "POSTGRES_DATA_PATH",
        localDev.postgres.dataPath,
        "Postgres 18+ declares the parent dir as its volume, not PGDATA itself.",
      ],
      ["REDIS_IMAGE", localDev.redis.image],
      ["REDIS_PORT", localDev.redis.containerPort],
    ],
  },
  {
    title: "Telemetry (api, worker, web) — OTLP logs to SigNoz",
    note: "Set OTEL_LOGS_ENABLED=false to run without a collector. Headers are only needed for a hosted backend.",
    entries: [
      ["OTEL_LOGS_ENABLED", "true"],
      [
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        telemetry.defaultEndpoint,
        `Collector base URL for apps run on the host ("${telemetry.logsPath}" is appended). For a remote SigNoz, use its https URL.`,
      ],
      [
        "OTEL_EXPORTER_OTLP_ENDPOINT_FROM_CONTAINER",
        `http://${telemetry.dockerHostAlias}:${telemetry.otlpHttpPort}`,
        "Same collector, as reachable from inside a container. Set both to the same value when the collector is remote.",
      ],
      ["OTEL_EXPORTER_OTLP_HEADERS", ""],
      [
        "SIGNOZ_UI_HOST_PORT",
        telemetry.signozUiHostPort,
        "Host port for the local SigNoz UI; 8080 is taken by the web app.",
      ],
      ["SIGNOZ_UI_CONTAINER_PORT", telemetry.signozUiContainerPort],
      ["OTLP_HTTP_PORT", telemetry.otlpHttpPort],
      ["OTLP_GRPC_PORT", telemetry.otlpGrpcPort],
    ],
  },
  {
    title: "Postgres (api, worker, migrations)",
    note: "Point both at a deployed database to run against it instead of the local compose one.",
    entries: [
      ["DATABASE_URL", localDev.urls.database, "Used by apps run on the host."],
      [
        "DATABASE_URL_FROM_CONTAINER",
        localDev.urls.databaseFromContainer,
        "Used by apps inside the compose network, where localhost is the container itself.",
      ],
    ],
  },
  {
    title: "Redis (api, worker)",
    note: "Automend runs DragonflyDB as its Redis server; it is wire-compatible, so this stays REDIS_URL.",
    entries: [
      ["REDIS_URL", localDev.urls.redis],
      ["REDIS_URL_FROM_CONTAINER", localDev.urls.redisFromContainer],
    ],
  },
  {
    title: "API",
    entries: [
      ["API_PORT", services.api.defaultPort],
      [
        "WEB_ORIGIN",
        http.cors.defaultOrigins.join(env.originListSeparator),
        "Comma-separated list of browser origins allowed to call the API.",
      ],
    ],
  },
  {
    title: "Worker",
    entries: [
      ["WORKER_HEALTH_PORT", services.worker.defaultHealthPort],
      ["WORKER_CONCURRENCY", services.worker.defaultConcurrency],
    ],
  },
  {
    title: "Web",
    note: "The production container only; the Vite dev server proxies /api itself.",
    entries: [
      ["WEB_PORT", services.web.defaultPort],
      ["API_URL", localDev.urls.api, "Server-side proxy target. Never sent to the browser."],
    ],
  },
];

const HEADER_WIDTH = 76;

function renderSectionHeading(title: string): string {
  const prefix = `# --- ${title} `;
  return prefix.padEnd(HEADER_WIDTH, "-");
}

function renderEnvExample(): string {
  const lines: string[] = [
    "# GENERATED FILE — do not edit by hand.",
    "# Regenerate with `bun run config:sync` after changing packages/shared/src/config.ts.",
    "#",
    "# Copy to .env before running the stack. docker-compose.yml reads this file's variables,",
    "# and packages/shared/src/env.ts validates them at process startup.",
    "# Never commit the resulting .env file.",
  ];

  for (const section of sections) {
    lines.push("", renderSectionHeading(section.title));

    if (section.note) {
      lines.push(`# ${section.note}`);
    }

    for (const [name, value, comment] of section.entries) {
      if (comment) {
        lines.push(`# ${comment}`);
      }
      lines.push(`${name}=${value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const targetPath = fileURLToPath(new URL("../../../.env.example", import.meta.url));
const generated = renderEnvExample();
const isCheckMode = process.argv.includes("--check");

if (isCheckMode) {
  const existing = await Bun.file(targetPath)
    .text()
    .catch(() => "");

  if (existing !== generated) {
    console.error(".env.example is out of date with config.ts — run `bun run config:sync`.");
    process.exit(1);
  }

  console.log(".env.example is up to date with config.ts");
  process.exit(0);
}

await Bun.write(targetPath, generated);
console.log(`wrote ${targetPath}`);
