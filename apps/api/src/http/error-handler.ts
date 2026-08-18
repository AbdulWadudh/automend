import { API_ERROR_CODES, isAutomendError } from "@automend/shared";
import type { Logger } from "@automend/shared/logger";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
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
    /**
     * Hono's own middleware signals a refusal by throwing this, carrying a complete response.
     *
     * It is passed through rather than folded into the envelope because the *headers* are the point:
     * `basicAuth` answers 401 with `WWW-Authenticate`, which is what makes a browser show its
     * credential prompt. Rebuilt as an envelope, that header is lost and the queue dashboard becomes
     * an unexplained 500 with no way to sign in.
     *
     * `instanceof` because it is a third-party class, not one of the branded factories in
     * `packages/shared/src/errors.ts` — those are still discriminated with `isAutomendError` below.
     */
    if (error instanceof HTTPException) {
      logger.warn({ status: error.status, method: c.req.method, path: c.req.path }, "request refused");
      return error.getResponse();
    }

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
