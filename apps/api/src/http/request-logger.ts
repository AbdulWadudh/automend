import type { Logger } from "@automend/shared/logger";
import type { MiddlewareHandler } from "hono";

/** One structured line per request. Header values are never logged — they carry credentials. */
export function createRequestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now();

    await next();

    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "request completed",
    );
  };
}
