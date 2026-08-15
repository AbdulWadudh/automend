/**
 * Sends a marked log record through the real logging path and reports whether the collector
 * accepted it.
 *
 * This deliberately exercises `createLogger` + `startLogTelemetry` rather than posting OTLP by
 * hand, so a passing run proves the *application's* pipeline works — the pino bridge, the
 * severity mapping, the attribute conversion and the exporter — not merely that the endpoint is
 * reachable.
 *
 *   bun run telemetry:verify
 *
 * Reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS from the environment, exactly
 * as the services do. Exits non-zero if the export fails.
 */

import { DiagLogLevel, diag } from "@opentelemetry/api";
import { config } from "../src/config";
import { loadApiEnv } from "../src/env";
import { createLogger } from "../src/logger";
import { buildOtlpLogsUrl, startLogTelemetry } from "../src/telemetry";

const VERIFICATION_SERVICE_NAME = "automend-telemetry-verify";

/**
 * The SDK reports export failures through its diagnostic channel and otherwise swallows them —
 * which is correct for production, but means a verification run has to listen in to tell the
 * difference between "delivered" and "silently dropped".
 */
const exportErrors: string[] = [];

diag.setLogger(
  {
    error: (message, ...args) => exportErrors.push([message, ...args.map(String)].join(" ")),
    warn: () => {},
    info: () => {},
    debug: () => {},
    verbose: () => {},
  },
  DiagLogLevel.ERROR,
);

// The API schema is the superset that includes the telemetry variables; the database URL and
// friends are unused here but must be present, so fall back to placeholders when running standalone.
const env = loadApiEnv({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? config.localDev.urls.database,
  REDIS_URL: process.env.REDIS_URL ?? config.localDev.urls.redis,
});

const marker = `automend-verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;

console.log(`endpoint : ${buildOtlpLogsUrl(endpoint)}`);
console.log(`service  : ${VERIFICATION_SERVICE_NAME}`);
console.log(`marker   : ${marker}`);

if (!env.OTEL_LOGS_ENABLED) {
  console.error("OTEL_LOGS_ENABLED is false — nothing would be exported. Aborting.");
  process.exit(1);
}

const telemetry = startLogTelemetry({
  serviceName: VERIFICATION_SERVICE_NAME,
  serviceVersion: config.appVersion,
  environment: env.NODE_ENV,
  endpoint,
  headers: env.OTEL_EXPORTER_OTLP_HEADERS,
});

const logger = createLogger({
  service: VERIFICATION_SERVICE_NAME,
  level: env.LOG_LEVEL,
  otelLogger: telemetry.logger,
});

// One record per severity, so the backend's severity filter can be checked too.
logger.info({ verificationMarker: marker, check: "info" }, "telemetry verification: info record");
logger.warn({ verificationMarker: marker, check: "warn" }, "telemetry verification: warn record");
logger.error(
  { verificationMarker: marker, check: "error", err: new Error("synthetic verification error") },
  "telemetry verification: error record",
);

// shutdown() force-flushes the batch processor and waits for the export to complete.
await telemetry.shutdown();

if (exportErrors.length > 0) {
  console.error("\nFAILED — the collector did not accept the records:");
  for (const message of exportErrors) {
    console.error(`  ${message}`);
  }
  process.exit(1);
}

console.log("\nPASSED — 3 records exported and accepted by the collector.");
console.log(`Find them in SigNoz with:  verificationMarker = ${marker}`);
console.log(`Or filter by service:      service.name = ${VERIFICATION_SERVICE_NAME}`);
