import { describe, expect, test } from "bun:test";
import {
  dependencyUnavailableError,
  envValidationError,
  flowValidationError,
  isAutomendError,
  isEnvValidationError,
} from "../src/errors";

describe("domain error factories", () => {
  test("produce real Error objects, so stack traces and throw/catch behave normally", () => {
    const error = flowValidationError("trigger step is missing");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("trigger step is missing");
    expect(error.name).toBe("FlowValidationError");
    expect(typeof error.stack).toBe("string");
  });

  test("carry the code and status the HTTP layer maps them to", () => {
    expect(flowValidationError("nope").httpStatus).toBe(400);
    expect(flowValidationError("nope").code).toBe("FLOW_VALIDATION_FAILED");
    expect(dependencyUnavailableError("nope").httpStatus).toBe(503);
  });

  test("preserve the underlying cause", () => {
    const cause = new Error("connection refused");
    const error = dependencyUnavailableError("postgres is unreachable", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("isAutomendError", () => {
  test("recognises errors built by the factories", () => {
    expect(isAutomendError(flowValidationError("nope"))).toBe(true);
  });

  test("rejects plain errors and non-errors", () => {
    expect(isAutomendError(new Error("boom"))).toBe(false);
    expect(isAutomendError({ code: "BAD_REQUEST", httpStatus: 400 })).toBe(false);
    expect(isAutomendError(undefined)).toBe(false);
  });

  test("rejects an error carrying a code that is not part of the vocabulary", () => {
    const impostor = Object.assign(new Error("boom"), { code: "MADE_UP", httpStatus: 400 });

    expect(isAutomendError(impostor)).toBe(false);
  });
});

describe("isEnvValidationError", () => {
  test("distinguishes startup configuration failures from domain errors", () => {
    expect(isEnvValidationError(envValidationError("missing DATABASE_URL"))).toBe(true);
    expect(isEnvValidationError(flowValidationError("nope"))).toBe(false);
  });
});
