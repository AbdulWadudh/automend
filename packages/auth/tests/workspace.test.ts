import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { buildPersonalWorkspaceName, buildWorkspaceSlug } from "../src/workspace";

const { organization: organizationConfig } = config.auth;
const { workspaceName } = config.validation;

describe("naming the workspace created with an account", () => {
  test("a named user gets a workspace named after them", () => {
    expect(buildPersonalWorkspaceName("Ada Lovelace")).toBe(
      `Ada Lovelace${organizationConfig.personalWorkspaceSuffix}`,
    );
  });

  test("a profile with no name still gets a workspace", () => {
    // OAuth profiles routinely arrive with an empty name, and sign-up must not fail on it.
    for (const missing of ["", "   ", null, undefined]) {
      expect(buildPersonalWorkspaceName(missing)).toBe(organizationConfig.fallbackWorkspaceName);
    }
  });

  test("a very long name is trimmed to what the column accepts", () => {
    const name = buildPersonalWorkspaceName("A".repeat(workspaceName.maxLength * 2));

    expect(name.length).toBeLessThanOrEqual(workspaceName.maxLength);
  });
});

describe("workspace slugs", () => {
  test("a slug is URL-safe", () => {
    expect(buildWorkspaceSlug("Ada Lovelace")).toMatch(/^[a-z0-9-]+$/);
    expect(buildWorkspaceSlug("ada@example.com")).toMatch(/^[a-z0-9-]+$/);
    expect(buildWorkspaceSlug("  ??? !!!  ")).toMatch(/^[a-z0-9-]+$/);
  });

  test("a slug keeps the readable part of the name", () => {
    expect(buildWorkspaceSlug("Ada Lovelace").startsWith("ada-lovelace-")).toBe(true);
  });

  test("two people with the same name get different slugs", () => {
    // Slugs are globally unique, and a check-then-insert would race two simultaneous sign-ups.
    const slugs = new Set(Array.from({ length: 50 }, () => buildWorkspaceSlug("Ada Lovelace")));

    expect(slugs.size).toBe(50);
  });

  test("a name made entirely of punctuation still produces a slug", () => {
    expect(buildWorkspaceSlug("!!!")).toMatch(/^[a-z0-9]+$/);
  });

  test("a slug fits the column even when the name does not", () => {
    expect(buildWorkspaceSlug("A".repeat(500)).length).toBeLessThanOrEqual(workspaceName.maxLength);
  });
});
