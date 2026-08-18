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

  /**
   * The studio's store fails the same way, quietly: Gateway keeps the database connection you added
   * and the session you signed in with under STORE_PATH, so a target that does not match it leaves
   * the store inside the container. Everything works until the container is recreated, and then the
   * connection is gone and there is nothing to say why.
   */
  test("the studio volume target matches the store path in config", () => {
    expect(volumeTargetFor("studio-data")).toBe(config.ops.databaseStudio.storePath);
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
  const apiSections = ["Authentication (api)", "Connectors (api)", "Operator consoles (api)"];

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

describe("the database studio", () => {
  /**
   * Both compose files declare it, and both hand it the same STORE_PATH — the value is written
   * literally in each, because Coolify rejects `${VAR}` in a volume target.
   */
  for (const [label, text] of [
    ["docker-compose.yml", composeText],
    ["deploy/coolify/docker-compose.yml", coolifyComposeText],
  ] as const) {
    test(`${label} declares the studio service`, () => {
      expect(text).toContain(`${config.ops.databaseStudio.serviceName}:`);
    });

    test(`${label} points the studio's store at the configured path`, () => {
      expect(text).toContain(`STORE_PATH: ${config.ops.databaseStudio.storePath}`);
    });

    test(`${label} gives the studio a master password`, () => {
      // The whole of what guards a database console. An unset one deploys an open one.
      expect(text).toContain("MASTERPASS:");
    });
  }

  test("the coolify stack writes the studio image tag that config declares", () => {
    // The root file substitutes ${STUDIO_IMAGE} from the generated .env; the coolify file has no .env
    // to read and writes the tag literally, so this is the only thing stopping the two drifting.
    expect(coolifyComposeText).toContain(config.ops.databaseStudio.image);
  });

  test("the coolify stack requires the studio's password rather than defaulting it", () => {
    // `:-` would deploy an unprotected console; `:?` stops the deploy instead.
    expect(/MASTERPASS: "\$\{STUDIO_PASSWORD:\?/.test(coolifyComposeText)).toBe(true);
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

  test("the studio declares a domain of its own, on its own port", () => {
    // It cannot be proxied under a prefix of the web app the way /ops/queues is: Gateway serves its
    // assets from the root of whatever origin it is on. So it needs a route of its own or it is
    // deployed and unreachable.
    const serviceName = config.ops.databaseStudio.serviceName.toUpperCase();

    expect(coolifyComposeText).toContain(`SERVICE_FQDN_${serviceName}_${config.ops.databaseStudio.containerPort}: /`);
  });
});
