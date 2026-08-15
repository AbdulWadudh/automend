/**
 * Browser-side log export.
 *
 * Records go to `/otlp/v1/logs` on this app's own origin, which the web server (or the Vite dev
 * server) forwards to the collector. That keeps the collector off the public internet and means
 * no CORS configuration is needed on it.
 *
 * Only things worth acting on are captured — uncaught errors and unhandled rejections — plus
 * whatever the app reports explicitly. Console noise is deliberately not mirrored: it would be
 * high volume and is the most likely place for user data to leak into telemetry.
 */

import { config } from "@automend/shared";
import { logs, type Logger as OtelLogger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { webEnv } from "./env";

const BROWSER_SERVICE_NAME = `${config.services.web.name}-browser`;

let browserLogger: OtelLogger | undefined;

function toErrorAttributes(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      "exception.type": error.name,
      "exception.message": error.message,
      "exception.stacktrace": error.stack ?? "",
    };
  }

  return { "exception.message": String(error) };
}

/** Records an error against the browser logger. No-op until `startBrowserTelemetry` has run. */
export function reportBrowserError(error: unknown, context: Record<string, string> = {}): void {
  browserLogger?.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "error",
    body: error instanceof Error ? error.message : String(error),
    attributes: {
      ...toErrorAttributes(error),
      ...context,
      // Useful for correlating a report with a session without identifying the user.
      "url.path": window.location.pathname,
    },
  });
}

export function reportBrowserEvent(message: string, attributes: Record<string, string> = {}): void {
  browserLogger?.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "info",
    body: message,
    attributes: { ...attributes, "url.path": window.location.pathname },
  });
}

/**
 * Starts browser log export and attaches the global error handlers.
 *
 * Safe to call once at startup; calling it again is a no-op so hot reloads do not stack exporters.
 */
export function startBrowserTelemetry(): void {
  if (browserLogger) {
    return;
  }

  const exporter = new OTLPLogExporter({
    url: `${config.http.routes.otlpProxyPrefix}${config.telemetry.logsPath}`,
  });

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: BROWSER_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: config.appVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: webEnv.mode,
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter,
        scheduledDelayMillis: config.telemetry.browser.scheduledDelayMs,
        maxExportBatchSize: config.telemetry.browser.maxExportBatchSize,
      }),
    ],
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  browserLogger = loggerProvider.getLogger(config.telemetry.browser.scopeName);

  window.addEventListener("error", (event) => {
    reportBrowserError(event.error ?? event.message, { "error.source": "window.onerror" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportBrowserError(event.reason, { "error.source": "unhandledrejection" });
  });

  // A tab being closed is the common case for losing a batch, so flush on the way out.
  window.addEventListener("pagehide", () => {
    void loggerProvider.forceFlush();
  });
}
