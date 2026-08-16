import { describe, expect, test } from "bun:test";
import { config } from "../src/config";

/**
 * `docker-compose.yml` normally reads every value from `.env`, which is generated from `config.ts`.
 * The Postgres data path is the one exception: Coolify's compose parser rejects `${VAR}` inside a
 * volume *target* as a path-injection risk, so that one path is written literally.
 *
 * These tests exist so the exception cannot rot into a silent inconsistency. Getting the mount
 * path wrong does not fail loudly — Postgres 18 writes its data outside the volume and everything
 * works until the container is recreated, at which point the database is empty.
 */
const composeText = await Bun.file(new URL("../../../docker-compose.yml", import.meta.url)).text();

function volumeTargetFor(volumeName: string): string | undefined {
  const match = new RegExp(`^\\s*-\\s*${volumeName}:(\\S+)\\s*$`, "m").exec(composeText);
  return match?.[1];
}

describe("docker-compose volume mounts", () => {
  test("the postgres volume target matches the path in config", () => {
    expect(volumeTargetFor("postgres-data")).toBe(config.localDev.postgres.dataPath);
  });

  test("no volume target uses variable substitution, which Coolify rejects", () => {
    const volumeLines = composeText
      .split("\n")
      .filter((line) => /^\s*-\s*[\w.-]+:\//.test(line))
      .map((line) => line.trim());

    expect(volumeLines.length).toBeGreaterThan(0);

    for (const line of volumeLines) {
      const target = line.slice(line.indexOf(":") + 1);
      expect(target).not.toContain("${");
    }
  });
});

describe("docker-compose environment", () => {
  test("the api receives the variables it cannot start without", () => {
    // The API's env loader rejects a missing AUTH_SECRET at startup, so leaving it out of the
    // compose file turns `docker compose up` into a crash loop rather than a warning.
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: asserting the literal
    // `${VAR}` text of a Compose file, not writing a template literal.
    expect(composeText).toContain("AUTH_SECRET: ${AUTH_SECRET}");
    expect(composeText).toContain("AUTH_BASE_URL: ${AUTH_BASE_URL}");
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: see above
  });
});

describe("docker-compose image tags", () => {
  test("images are substituted from .env rather than hardcoded", () => {
    // The inverse of the volume rule: images *are* safe to substitute, and doing so keeps the
    // Postgres major version declared once, in config.
    //
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: asserting the literal
    // `${VAR}` text of a Compose file, not writing a template literal.
    expect(composeText).toContain("image: ${POSTGRES_IMAGE}");
    expect(composeText).toContain("image: ${REDIS_IMAGE}");
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: see above
  });
});
