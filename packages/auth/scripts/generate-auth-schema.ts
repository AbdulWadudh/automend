/**
 * Regenerates `packages/db/src/auth-schema.ts` from the Better-Auth configuration.
 *
 *   bun run auth:schema         rewrite the schema
 *   bun run auth:schema:check   fail if it is out of date (use in CI)
 *
 * Better-Auth decides which tables and columns it needs from the options it is given — enabling a
 * plugin adds tables, and a version bump can add a column. `getAuthTables` reports that shape from
 * the installed library, so this script asks the library rather than a human transcribing a
 * documentation page. The result is committed and turned into a Drizzle migration like any other
 * schema change; nothing here touches a database.
 *
 * Two deliberate departures from a literal transcription:
 *
 * 1. Identifiers are `uuid`, not `text`. Better-Auth treats an id as opaque and is configured to
 *    generate UUIDs (`advanced.database.generateId`), which lets `flows.tenant_id` be a real
 *    foreign key to `organization.id`.
 * 2. Foreign keys are indexed. Better-Auth does not ask for it, but every one of these columns is
 *    a lookup path (a session by user, a member by organization) and an unindexed one is a table
 *    scan on every request.
 *
 * The Drizzle *property* names must stay exactly as Better-Auth names its fields — the adapter
 * looks columns up by that key. Only the SQL column name is ours, and it is snake_case to match
 * the rest of the schema.
 */

import { fileURLToPath } from "node:url";
import { type DBFieldAttribute, getAuthTables } from "better-auth/db";
import { authSchemaOptions } from "../src/options";

const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g;

function toSnakeCase(value: string): string {
  return value.replace(CAMEL_CASE_BOUNDARY, "$1_$2").toLowerCase();
}

/** Drizzle imports are emitted from what the schema actually uses, so the file has no unused ones. */
const usedColumnTypes = new Set<string>(["pgTable", "uuid"]);

function columnBuilder(field: DBFieldAttribute): string {
  if (field.references) {
    usedColumnTypes.add("uuid");
    return "uuid";
  }

  switch (field.type) {
    case "string":
      usedColumnTypes.add("text");
      return "text";
    case "boolean":
      usedColumnTypes.add("boolean");
      return "boolean";
    case "date":
      usedColumnTypes.add("timestamp");
      return "timestamp";
    case "json":
      usedColumnTypes.add("jsonb");
      return "jsonb";
    case "number":
      if (field.bigint) {
        usedColumnTypes.add("bigint");
        return "bigint";
      }
      usedColumnTypes.add("integer");
      return "integer";
    default:
      // An unmapped type must stop the build rather than silently produce a wrong column: a
      // string[] or an enum needs a decision, not a default.
      throw new Error(`No Postgres column mapping for Better-Auth field type "${String(field.type)}"`);
  }
}

function columnArguments(builder: string, columnName: string): string {
  if (builder === "timestamp") {
    return `"${columnName}", { withTimezone: true }`;
  }

  if (builder === "bigint") {
    return `"${columnName}", { mode: "number" }`;
  }

  return `"${columnName}"`;
}

function renderColumn(fieldKey: string, field: DBFieldAttribute, propertyName: string): string {
  const builder = columnBuilder(field);
  const columnName = toSnakeCase(propertyName);
  const parts = [`${builder}(${columnArguments(builder, columnName)})`];

  if (field.references) {
    const onDelete = field.references.onDelete ?? "cascade";
    parts.push(`.references(() => ${field.references.model}.${field.references.field}, { onDelete: "${onDelete}" })`);
  }

  // Better-Auth defaults `required` to true, so only an explicit false makes a column nullable.
  if (field.required !== false) {
    parts.push(".notNull()");
  }

  if (field.unique) {
    parts.push(".unique()");
  }

  const rendered = parts.join("");

  return `    ${propertyName}: ${rendered},${fieldKey === propertyName ? "" : ` // Better-Auth field: ${fieldKey}`}`;
}

function renderIndexes(tableName: string, indexedColumns: string[]): string {
  if (indexedColumns.length === 0) {
    return "";
  }

  usedColumnTypes.add("index");

  const entries = indexedColumns
    .map((column) => `    index("${tableName}_${toSnakeCase(column)}_idx").on(table.${column}),`)
    .join("\n");

  return `,\n  (table) => [\n${entries}\n  ]`;
}

function renderTable(model: string, table: { modelName: string; fields: Record<string, DBFieldAttribute> }): string {
  const columns: string[] = [`    id: uuid("id").primaryKey(),`];
  const indexedColumns: string[] = [];

  for (const [fieldKey, field] of Object.entries(table.fields)) {
    // The adapter resolves a column by `fieldName ?? fieldKey`, so that is the property name.
    const propertyName = field.fieldName ?? fieldKey;

    columns.push(renderColumn(fieldKey, field, propertyName));

    if (field.references || field.index) {
      indexedColumns.push(propertyName);
    }
  }

  return [
    `export const ${model} = pgTable(`,
    `  "${table.modelName}",`,
    `  {`,
    columns.join("\n"),
    `  }${renderIndexes(table.modelName, indexedColumns)},`,
    `);`,
  ].join("\n");
}

function renderSchemaFile(): string {
  const tables = getAuthTables(authSchemaOptions);
  const rendered = Object.entries(tables).map(([model, table]) => renderTable(model, table));

  const imports = [...usedColumnTypes].sort().join(", ");

  const header = [
    "/**",
    " * GENERATED FILE — do not edit by hand.",
    " *",
    " * Regenerate with `bun run auth:schema` after changing packages/auth/src/options.ts or",
    " * upgrading better-auth, then `bun run db:generate` to turn the difference into a migration.",
    " *",
    " * These are the tables Better-Auth owns. Property names match its field names exactly, because",
    " * the Drizzle adapter looks columns up by them; the SQL column names are snake_case like the",
    " * rest of the schema. Identifiers are UUIDs so tenant-owned tables can carry a real foreign key",
    " * to `organization.id`.",
    " */",
    "",
    `import { ${imports} } from "drizzle-orm/pg-core";`,
    "",
  ].join("\n");

  return `${header}\n${rendered.join("\n\n")}\n`;
}

/**
 * Formatted by Biome before it is written, not after.
 *
 * The repository formats every checked-in file, so a generator that emitted its own style would
 * produce a file that `biome check --write` immediately rewrites — and `--check` would then report
 * a difference that regenerating cannot fix.
 */
async function formatWithBiome(source: string, filePath: string): Promise<string> {
  const biome = Bun.spawn(["bunx", "biome", "format", `--stdin-file-path=${filePath}`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  biome.stdin.write(source);
  await biome.stdin.end();

  const [formatted, problems, exitCode] = await Promise.all([
    new Response(biome.stdout).text(),
    new Response(biome.stderr).text(),
    biome.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Biome could not format the generated schema:\n${problems}`);
  }

  return formatted;
}

const targetPath = fileURLToPath(new URL("../../db/src/auth-schema.ts", import.meta.url));
const generated = await formatWithBiome(renderSchemaFile(), targetPath);
const isCheckMode = process.argv.includes("--check");

if (isCheckMode) {
  const existing = await Bun.file(targetPath)
    .text()
    .catch(() => "");

  if (existing !== generated) {
    console.error("packages/db/src/auth-schema.ts is out of date with the auth options — run `bun run auth:schema`.");
    process.exit(1);
  }

  console.log("auth-schema.ts is up to date with the Better-Auth options");
  process.exit(0);
}

await Bun.write(targetPath, generated);
console.log(`wrote ${targetPath}`);
