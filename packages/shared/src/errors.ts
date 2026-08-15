/**
 * Domain error vocabulary.
 *
 * Errors are typed rather than stringly-typed: every failure carries a stable machine-readable
 * `code` and one obvious HTTP mapping, so route handlers never invent status codes.
 *
 * They are built by factory functions rather than declared as classes, per the codebase's
 * functional-first rule. `new Error(...)` is still used inside the factories because it is the
 * only way to get a real stack trace; discrimination is done with the exported type guards
 * instead of `instanceof`.
 */

export const API_ERROR_CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  FLOW_VALIDATION_FAILED: "FLOW_VALIDATION_FAILED",
  STEP_EXECUTION_FAILED: "STEP_EXECUTION_FAILED",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * The statuses domain errors are allowed to map to. Keeping this a closed union (rather than
 * `number`) means the HTTP layer can hand `httpStatus` straight to the framework without a cast.
 */
export type ApiHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;

/** Any error that can be mapped to an HTTP response or an execution state. */
export type AutomendError = Error & {
  readonly code: ApiErrorCode;
  readonly httpStatus: ApiHttpStatus;
};

export type DomainErrorOptions = {
  cause?: unknown;
};

function createAutomendError(
  name: string,
  code: ApiErrorCode,
  httpStatus: ApiHttpStatus,
  message: string,
  options?: DomainErrorOptions,
): AutomendError {
  return Object.assign(new Error(message, options), { name, code, httpStatus });
}

/** A flow definition failed structural or semantic validation. */
export function flowValidationError(message: string, options?: DomainErrorOptions): AutomendError {
  return createAutomendError("FlowValidationError", API_ERROR_CODES.FLOW_VALIDATION_FAILED, 400, message, options);
}

/** A single step of a flow execution failed. */
export function stepExecutionError(message: string, options?: DomainErrorOptions): AutomendError {
  return createAutomendError("StepExecutionError", API_ERROR_CODES.STEP_EXECUTION_FAILED, 500, message, options);
}

/** An external dependency (Postgres, Redis, an upstream connector) could not be reached. */
export function dependencyUnavailableError(message: string, options?: DomainErrorOptions): AutomendError {
  return createAutomendError(
    "DependencyUnavailableError",
    API_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
    503,
    message,
    options,
  );
}

/** The request body, query or params did not match the expected schema. */
export function requestValidationError(message: string, options?: DomainErrorOptions): AutomendError {
  return createAutomendError("RequestValidationError", API_ERROR_CODES.BAD_REQUEST, 400, message, options);
}

/** The requested resource does not exist, or is not visible to the caller's tenant. */
export function notFoundError(message: string, options?: DomainErrorOptions): AutomendError {
  return createAutomendError("NotFoundError", API_ERROR_CODES.NOT_FOUND, 404, message, options);
}

export function isAutomendError(value: unknown): value is AutomendError {
  if (!(value instanceof Error)) {
    return false;
  }

  const candidate = value as Partial<AutomendError>;

  return (
    typeof candidate.code === "string" && candidate.code in API_ERROR_CODES && typeof candidate.httpStatus === "number"
  );
}

const ENV_VALIDATION_ERROR_NAME = "EnvValidationError";

/**
 * Signals missing or malformed environment variables.
 *
 * Deliberately outside the `AutomendError` vocabulary: this can only happen during process
 * startup, before anything is serving traffic, so it never maps to an HTTP response.
 */
export function envValidationError(message: string): Error {
  return Object.assign(new Error(message), { name: ENV_VALIDATION_ERROR_NAME });
}

export function isEnvValidationError(value: unknown): value is Error {
  return value instanceof Error && value.name === ENV_VALIDATION_ERROR_NAME;
}
