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

const coolifyComposeText = await Bun.file(
  new URL("../../../deploy/coolify/docker-compose.yml", import.meta.url),
).text();
const envExampleText = await Bun.file(new URL("../../../.env.example", import.meta.url)).text();

/**
 * The variables one `# --- Title ---` section of the generated `.env.example` declares.
 *
 * Read from the file rather than listed here on purpose: a hand-written list is what let
 * SECRETS_KEY reach production missing from both compose files, since the test named only the two
 * variables that happened to exist when it was written. Add a connector to `config.ts` and this
 * picks it up.
 */
function variablesInSection(sectionTitle: string): string[] {
  const sections = envExampleText.split(/^# --- /m);
  const section = sections.find((candidate) => candidate.startsWith(sectionTitle)) ?? "";
  const names: string[] = [];

  for (const match of section.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
    const name = match[1];

    if (name) {
      names.push(name);
    }
  }

  return names;
}

describe("docker-compose environment", () => {
  // Every api variable is passed by both files or neither. The API validates its environment at
  // startup and exits, so a variable missing from a compose file is a crash loop on deploy — and
  // for an optional one, a connector that silently never appears.
  const apiSections = ["Authentication (api)", "Connectors (api)"];

  for (const sectionTitle of apiSections) {
    const variables = variablesInSection(sectionTitle);

    test(`.env.example declares variables under "${sectionTitle}"`, () => {
      // Guards the parser itself: a renamed section would otherwise make every assertion below
      // pass over an empty list.
      expect(variables.length).toBeGreaterThan(0);
    });

    for (const variable of variables) {
      test(`the api service receives ${variable} in both compose files`, () => {
        expect(composeText).toContain(`${variable}:`);
        expect(coolifyComposeText).toContain(`${variable}:`);
      });
    }
  }
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

/**
 * Coolify's magic variables are not ordinary environment variables. A `SERVICE_FQDN_<SERVICE>_<PORT>`
 * key is *consumed* by its compose parser — it generates the domain, registers the proxy route and
 * moves on without ever passing the variable to a container. Reading it back as `${SERVICE_FQDN_…}`
 * therefore yields an empty string, which the api rejects during env validation: the deploy reports
 * only "container api is unhealthy", several minutes and one restart loop later.
 */
describe("coolify magic variables", () => {
  test("no SERVICE_FQDN_* variable is read as a value", () => {
    const references = coolifyComposeText
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .filter((line) => /\$\{?SERVICE_FQDN_/.test(line));

    expect(references).toEqual([]);
  });

  test("the web service declares its domain, and declares it as a path", () => {
    // The value of the key is the path Coolify appends to the domain it generates. Anything that
    // is not a path — a URL, or a reference to the variable itself — is appended verbatim.
    expect(coolifyComposeText).toContain("SERVICE_FQDN_WEB_8080: /");
  });
});
