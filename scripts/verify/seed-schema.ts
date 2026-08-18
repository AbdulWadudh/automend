/**
 * Puts one row in every table, whatever the schema happens to be.
 *
 * The replay needs populated tables — that is the whole point, since the migrations it is checking
 * pass on empty ones. A hand-written fixture cannot do this job: it is written against one schema
 * and the reference release moves, so it silently stops matching and the replay starts proving
 * nothing. So the rows are derived from the database in front of us instead.
 *
 * Columns that reference another table are filled from a row that is already there, and the passes
 * repeat until no more tables can be filled. That resolves insert order without having to
 * topologically sort the foreign keys: `organization` succeeds on the first pass, `flows` on the
 * next, and a table whose parent never gets a row is reported rather than retried forever.
 */

import { run } from "./docker";

type Column = { table: string; column: string; dataType: string };
type ForeignKey = { table: string; column: string; referencedTable: string; referencedColumn: string };

const TABLES_QUERY = `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;

/** Only these have to be supplied; anything nullable or defaulted can be left out of the insert. */
const REQUIRED_COLUMNS_QUERY = `
  SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND is_nullable = 'NO' AND column_default IS NULL
  ORDER BY table_name, ordinal_position`;

const FOREIGN_KEYS_QUERY = `
  SELECT kcu.table_name, kcu.column_name, ccu.table_name, ccu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;

export type SeedTarget = {
  container: string;
  user: string;
  database: string;
};

async function query(target: SeedTarget, sql: string): Promise<string[][]> {
  const result = await run([
    "docker",
    "exec",
    target.container,
    "psql",
    "-U",
    target.user,
    "-d",
    target.database,
    "-tAc",
    sql,
  ]);

  if (!result.ok) {
    throw new Error(`could not read the schema:\n${result.output}`);
  }

  return result.output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));
}

/** Valid for the column's type and otherwise meaningless — nothing reads these rows. */
function placeholderFor(dataType: string): string {
  if (dataType === "uuid") return "gen_random_uuid()";
  if (dataType.startsWith("timestamp") || dataType === "date") return "now()";
  if (dataType === "jsonb" || dataType === "json") return `'{}'::${dataType}`;
  if (dataType === "boolean") return "false";
  if (["integer", "bigint", "smallint", "numeric", "real", "double precision"].includes(dataType)) return "0";

  return "'verify-fixture'";
}

function buildInsert(table: string, columns: Column[], foreignKeys: ForeignKey[]): string {
  const required = columns.filter((column) => column.table === table);

  if (required.length === 0) {
    return `INSERT INTO "${table}" DEFAULT VALUES`;
  }

  const names = required.map((column) => `"${column.column}"`).join(", ");
  const values = required
    .map((column) => {
      const reference = foreignKeys.find((key) => key.table === table && key.column === column.column);

      return reference
        ? `(SELECT "${reference.referencedColumn}" FROM "${reference.referencedTable}" LIMIT 1)`
        : placeholderFor(column.dataType);
    })
    .join(", ");

  return `INSERT INTO "${table}" (${names}) VALUES (${values})`;
}

export type SeedReport = {
  seeded: string[];
  skipped: { table: string; reason: string }[];
};

export async function seedEveryTable(target: SeedTarget): Promise<SeedReport> {
  const tables = (await query(target, TABLES_QUERY)).map((row) => row[0] ?? "").filter((table) => table.length > 0);
  const columns: Column[] = (await query(target, REQUIRED_COLUMNS_QUERY)).map((row) => ({
    table: row[0] ?? "",
    column: row[1] ?? "",
    dataType: row[2] ?? "",
  }));
  const foreignKeys: ForeignKey[] = (await query(target, FOREIGN_KEYS_QUERY)).map((row) => ({
    table: row[0] ?? "",
    column: row[1] ?? "",
    referencedTable: row[2] ?? "",
    referencedColumn: row[3] ?? "",
  }));

  const remaining = new Set(tables);
  const seeded: string[] = [];
  const lastError = new Map<string, string>();

  // One pass per table is the most that can ever be needed: each pass either fills a table or the
  // chain it is waiting on is genuinely unsatisfiable.
  for (let pass = 0; pass < tables.length && remaining.size > 0; pass++) {
    let progressed = false;

    for (const table of [...remaining]) {
      const insert = buildInsert(table, columns, foreignKeys);
      const result = await run([
        "docker",
        "exec",
        target.container,
        "psql",
        "-U",
        target.user,
        "-d",
        target.database,
        "-c",
        insert,
      ]);

      if (result.ok) {
        remaining.delete(table);
        seeded.push(table);
        progressed = true;
        continue;
      }

      lastError.set(
        table,
        result.output.split("\n").find((line) => line.includes("ERROR")) ?? result.output.split("\n")[0] ?? "",
      );
    }

    if (!progressed) {
      break;
    }
  }

  return {
    seeded,
    skipped: [...remaining].map((table) => ({ table, reason: lastError.get(table) ?? "unknown" })),
  };
}
