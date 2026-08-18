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

const { localDev, services, env, http, telemetry, auth, connectors, ops, webClient } = config;

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
      // POSTGRES_DATA_PATH is deliberately absent: Coolify forbids variable substitution in a
      // volume target, so docker-compose.yml writes the path literally and tests/compose.test.ts
      // guards it against config.
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
        `Collector base URL ("${telemetry.logsPath}" is appended). Normally the deployed SigNoz.`,
      ],
      ["OTEL_EXPORTER_OTLP_HEADERS", ""],
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
    title: "Authentication (api)",
    note: "AUTH_SECRET is required and has no default — the API refuses to start without it.",
    entries: [
      ["AUTH_SECRET", "", `At least ${auth.secretMinLength} characters. Generate with: openssl rand -base64 32`],
      [
        "AUTH_BASE_URL",
        localDev.urls.webDev,
        "The origin the browser uses. OAuth redirect URIs are built from it, so it must match what is registered with the provider.",
      ],
      [
        "GOOGLE_CLIENT_ID",
        "",
        `Leave both blank to disable "Continue with ${auth.socialProviders.google.label}". Redirect URI: ${localDev.urls.webDev}${auth.basePath}/callback/${auth.socialProviders.google.id}`,
      ],
      ["GOOGLE_CLIENT_SECRET", ""],
    ],
  },
  {
    title: "Connectors (api) — services flows act through",
    note: [
      "SECRETS_KEY is required. Each provider pair is optional; both halves must be set for it to appear.",
      "Connecting a service is a SEPARATE OAuth registration from signing in with it, so each needs its",
      `own redirect URI. Google reuses GOOGLE_CLIENT_ID above and needs BOTH of these registered:`,
      `  sign-in:   ${localDev.urls.webDev}${auth.basePath}/callback/${auth.socialProviders.google.id}`,
      `  connector: ${localDev.urls.webDev}${auth.basePath}/oauth2/callback/${auth.socialProviders.google.id}${connectors.connectionProviderSuffix}`,
    ].join("\n# "),
    entries: [
      [
        "SECRETS_KEY",
        "",
        `Envelope-encrypts stored connector tokens. Generate with: openssl rand -base64 ${config.secrets.keyLengthBytes}`,
      ],
      [
        "SLACK_CLIENT_ID",
        "",
        `Redirect URI: ${localDev.urls.webDev}${auth.basePath}/oauth2/callback/slack${connectors.connectionProviderSuffix}`,
      ],
      ["SLACK_CLIENT_SECRET", ""],
      [
        "DISCORD_CLIENT_ID",
        "",
        `Redirect URI: ${localDev.urls.webDev}${auth.basePath}/oauth2/callback/discord${connectors.connectionProviderSuffix}`,
      ],
      ["DISCORD_CLIENT_SECRET", ""],
    ],
  },
  {
    title: "Worker",
    note: [
      "The worker also reads AUTH_SECRET, SECRETS_KEY, AUTH_BASE_URL and the connector pairs above — the",
      "same values as the API, not copies. It needs them to refresh a connection's OAuth token and to",
      "decrypt a stored one; configured differently from the API it would decrypt nothing.",
    ].join("\n# "),
    entries: [
      ["WORKER_HEALTH_PORT", services.worker.defaultHealthPort],
      ["WORKER_CONCURRENCY", services.worker.defaultConcurrency],
      [
        "ENGINE_ALLOW_PRIVATE_NETWORK",
        String(config.engine.http.allowPrivateNetworkByDefault),
        [
          "Lets flows call private, loopback and internal addresses. An HTTP step's URL can come from a",
          "flow's DATA, so with this on whoever sends a webhook chooses where the worker connects — reaching",
          "Postgres, Redis or anything else on the network. Turn it on only to automate against a service on",
          "your own network. Link-local (169.254.0.0/16) stays refused either way: that is cloud metadata.",
        ].join("\n# "),
      ],
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
  {
    title: "Operator consoles (api)",
    note: [
      `Reached from ${webClient.routes.operations} in the app, which asks for OPS_DASHBOARD_PASSWORD and`,
      `then links onward. Blank on purpose: with either half unset the queue dashboard is not mounted at`,
      `all. It reads across EVERY tenant's job payloads and can enqueue work the worker will run, so the`,
      `credential is an administrative one and there is no safe default to ship.`,
    ].join("\n# "),
    entries: [
      ["OPS_DASHBOARD_USER", ""],
      [
        "OPS_DASHBOARD_PASSWORD",
        "",
        `At least ${ops.queueDashboard.passwordMinLength} characters, or the api refuses to start. Generate with: openssl rand -base64 24`,
      ],
      [
        "STUDIO_URL",
        localDev.urls.studio,
        [
          `The database studio's address as the BROWSER sees it, which is all the api can know: the studio`,
          `runs on its own origin. Blank means the Operations page reports it as unavailable rather than`,
          `offering a link that goes nowhere — so a deployment must set its real domain here.`,
        ].join("\n# "),
      ],
    ],
  },
  {
    title: "Database studio (docker-compose only)",
    note: [
      `Drizzle Gateway, on ${localDev.urls.studio} once started. Not part of \`dev:up\`: bring it up`,
      `with \`docker compose up ${ops.databaseStudio.serviceName}\`, then add a connection in its UI using`,
      `DATABASE_URL_FROM_CONTAINER above — from in there, localhost is the container itself.`,
      `Do NOT blank STUDIO_PASSWORD. Gateway reads an absent master password as "accept any password":`,
      `it still shows a login box and lets anything through, which looks protected and is not.`,
    ].join("\n# "),
    entries: [
      ["STUDIO_IMAGE", ops.databaseStudio.image],
      ["STUDIO_PORT", ops.databaseStudio.containerPort],
      [
        "STUDIO_PASSWORD",
        ops.databaseStudio.localPassword,
        "Becomes the image's MASTERPASS. A local throwaway; a deployment sets its own.",
      ],
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
