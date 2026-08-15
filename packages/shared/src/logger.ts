/**
 * Structured JSON logging for every server-side process.
 *
 * Logs always go to stdout — the container runtime (Coolify) collects them from there, so there is
 * deliberately no file transport and no pretty-printing in production.
 *
 * When telemetry is supplied, the *same* records are additionally bridged to OpenTelemetry and
 * exported to the collector. Both destinations, never one instead of the other: stdout is what you
 * read during `docker compose logs`, and the collector is what you search in SigNoz.
 */

import { Writable } from "node:stream";
import type { AnyValue } from "@opentelemetry/api-logs";
import pino, { type Logger } from "pino";
import { config } from "./config";
import { type OtelLogger, toSeverityNumber } from "./telemetry";

export type LoggerOptions = {
  service: string;
  level: string;
  /** Omit to log to stdout only — which is what tests and one-shot scripts want. */
  otelLogger?: OtelLogger;
};

const RESERVED_LOG_FIELDS = new Set<string>(config.telemetry.reservedLogFields);

/**
 * OTel attributes must be primitives or arrays of primitives, so anything structural (a
 * serialised error, a nested context object) is stringified rather than dropped.
 */
function toLogAttributes(fields: Record<string, unknown>): Record<string, AnyValue> {
  const attributes: Record<string, AnyValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      continue;
    }

    const isPrimitive = typeof value === "string" || typeof value === "number" || typeof value === "boolean";

    attributes[key] = isPrimitive ? value : JSON.stringify(value);
  }

  return attributes;
}

function emitLogRecord(serialisedLine: string, otelLogger: OtelLogger): void {
  let record: Record<string, unknown>;

  try {
    record = JSON.parse(serialisedLine) as Record<string, unknown>;
  } catch {
    // A line that is not JSON cannot be mapped onto a log record. Dropping it is the right
    // trade-off: the logging path must never throw into the caller.
    return;
  }

  const { level, time, msg } = record;
  const attributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!RESERVED_LOG_FIELDS.has(key)) {
      attributes[key] = value;
    }
  }

  const levelLabel = typeof level === "string" ? level : config.env.defaultLogLevel;

  otelLogger.emit({
    severityNumber: toSeverityNumber(levelLabel),
    severityText: levelLabel,
    body: typeof msg === "string" ? msg : serialisedLine,
    timestamp: typeof time === "number" ? time : undefined,
    attributes: toLogAttributes(attributes),
  });
}

/**
 * A pino destination that forwards each serialised record to OpenTelemetry.
 *
 * Nothing here is allowed to throw or to block: pino may hand over several newline-delimited
 * records in one chunk, and the OTel batch processor queues them for background export.
 */
function createOtelBridgeStream(otelLogger: OtelLogger): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      const lines = String(chunk).split("\n");

      for (const line of lines) {
        if (line.trim().length > 0) {
          emitLogRecord(line, otelLogger);
        }
      }

      callback();
    },
  });
}

export function createLogger({ service, level, otelLogger }: LoggerOptions): Logger {
  const pinoOptions = {
    name: service,
    level,
    formatters: {
      // Emit `"level":"info"` rather than pino's default numeric level, so log processors that
      // expect a human-readable severity work without a translation step. The OTel bridge maps
      // this label onto a severity number.
      level: (label: string) => ({ level: label }),
    },
    redact: {
      paths: [...config.logging.redactedPaths],
      censor: config.logging.redactionCensor,
    },
  };

  if (!otelLogger) {
    return pino(pinoOptions);
  }

  return pino(
    pinoOptions,
    pino.multistream([{ stream: process.stdout }, { stream: createOtelBridgeStream(otelLogger) }]),
  );
}

export type { Logger };
