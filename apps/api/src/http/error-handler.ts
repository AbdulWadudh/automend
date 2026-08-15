import { API_ERROR_CODES, isAutomendError } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { respondWithError } from "./envelope";

/**
 * Maps thrown errors onto the error envelope.
 *
 * Known domain errors carry their own code and status. Anything else is reported as a generic
 * 500: an unexpected error's message can contain internals (a connection string, a driver dump)
 * and must never be echoed to the caller.
 */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return (error, c) => {
    if (isAutomendError(error)) {
      logger.warn({ err: error, code: error.code, method: c.req.method, path: c.req.path }, "request failed");
      return respondWithError(c, error.code, error.message, error.httpStatus);
    }

    logger.error({ err: error, method: c.req.method, path: c.req.path }, "unhandled error");
    return respondWithError(c, API_ERROR_CODES.INTERNAL_ERROR, "Internal server error", 500);
  };
}

export const notFoundHandler: NotFoundHandler = (c) =>
  respondWithError(c, API_ERROR_CODES.NOT_FOUND, `No route matches ${c.req.method} ${c.req.path}`, 404);
