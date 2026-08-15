import { describe, expect, test } from "bun:test";
import { flowExecutionJobSchema } from "../src/queue";

const VALID_JOB = {
  executionId: "7f3f8a2c-1f4d-4a6e-9c2b-2b6c1c0f9a11",
  flowId: "a1b2c3d4-e5f6-4789-a012-3456789abcde",
  tenantId: "11111111-2222-4333-8444-555555555555",
  idempotencyKey: "exec:7f3f8a2c:step:0",
  triggeredAt: "2026-08-15T10:00:00.000Z",
};

describe("flowExecutionJobSchema", () => {
  test("accepts a well-formed job payload", () => {
    const result = flowExecutionJobSchema.safeParse(VALID_JOB);

    expect(result.success).toBe(true);
  });

  test("rejects a payload without a tenant, so no job can execute unscoped", () => {
    const { tenantId: _tenantId, ...withoutTenant } = VALID_JOB;
    const result = flowExecutionJobSchema.safeParse(withoutTenant);

    expect(result.success).toBe(false);
  });

  test("rejects a payload without an idempotency key", () => {
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = VALID_JOB;
    const result = flowExecutionJobSchema.safeParse(withoutKey);

    expect(result.success).toBe(false);
  });

  test("rejects an empty idempotency key", () => {
    const result = flowExecutionJobSchema.safeParse({ ...VALID_JOB, idempotencyKey: "" });

    expect(result.success).toBe(false);
  });

  test("rejects identifiers that are not UUIDs", () => {
    const result = flowExecutionJobSchema.safeParse({ ...VALID_JOB, flowId: "42" });

    expect(result.success).toBe(false);
  });

  test("strips unknown fields rather than passing them to business logic", () => {
    const result = flowExecutionJobSchema.parse({ ...VALID_JOB, injected: "not-in-schema" });

    expect(result).not.toHaveProperty("injected");
  });
});
