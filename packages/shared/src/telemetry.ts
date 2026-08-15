/**
 * OpenTelemetry log export for the server-side apps.
 *
 * Logs are shipped over OTLP/HTTP to a collector — Automend runs SigNoz, but nothing here is
 * SigNoz-specific, so any OTLP backend works. Named for the protocol, not the vendor, for the
 * same reason `REDIS_URL` is not called `DRAGONFLY_URL`.
 *
 * This does not replace stdout. `createLogger` writes to both: the container platform keeps
 * capturing structured JSON from stdout, and the same records are exported to the collector.
 * If the collector is unreachable the batch processor drops records after retrying — logging must
 * never take an app down, and it must never block a request.
 */

import { logs, type Logger as OtelLogger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { config } from "./config";

export type TelemetryOptions = {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** Base OTLP/HTTP endpoint, e.g. `http://localhost:4318`. The logs path is appended. */
  endpoint: string;
  /** Extra OTLP headers, e.g. an ingestion key when a backend requires one. */
  headers?: Record<string, string>;
};

export type Telemetry = {
  logger: OtelLogger;
  /** Flushes pending records and closes the exporter. Call during graceful shutdown. */
  shutdown: () => Promise<void>;
};

export function buildOtlpLogsUrl(endpoint: string): string {
  // Tolerate a trailing slash on the configured endpoint so both forms behave the same.
  return `${endpoint.replace(/\/+$/, "")}${config.telemetry.logsPath}`;
}

/**
 * Creates the OTLP log pipeline and registers it as the global logger provider.
 *
 * The provider is registered globally so any library that emits through `@opentelemetry/api-logs`
 * lands in the same pipeline, but the returned `logger` is what `createLogger` bridges Pino into.
 */
export function startLogTelemetry(options: TelemetryOptions): Telemetry {
  const exporter = new OTLPLogExporter({
    url: buildOtlpLogsUrl(options.endpoint),
    headers: options.headers,
  });

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: options.environment,
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter,
        maxQueueSize: config.telemetry.export.maxQueueSize,
        maxExportBatchSize: config.telemetry.export.maxExportBatchSize,
        scheduledDelayMillis: config.telemetry.export.scheduledDelayMs,
      }),
    ],
  });

  logs.setGlobalLoggerProvider(loggerProvider);

  return {
    logger: loggerProvider.getLogger(options.serviceName),
    shutdown: () => loggerProvider.shutdown(),
  };
}

const LEVEL_TO_SEVERITY_NUMBER: Record<string, number> = config.telemetry.logLevelToSeverityNumber;

export function toSeverityNumber(levelLabel: string): SeverityNumber {
  return (LEVEL_TO_SEVERITY_NUMBER[levelLabel] ?? SeverityNumber.INFO) as SeverityNumber;
}

export type { OtelLogger };
