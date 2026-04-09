/**
 * Pure helper functions for generating CRUD SQL statements.
 * Two strategies: inline (MSSQL/DuckDB) and parameterized (Postgres/MySQL/SQLite).
 */

export interface SqlWithBindings {
  sql: string;
  bindValues?: unknown[];
}

/**
 * A callback that returns the SQL type name for a column, or undefined
 * if no CAST is needed (e.g. text types, user-defined types).
 * Used by parameterized adapters (Postgres) to wrap `$N` in `CAST($N AS type)`.
 */
export type CastLookup = (column: string) => string | undefined;

type QuoteIdFn = (id: string) => string;

// ─── Shared ──────────────────────────────────────────────────────────

export function formatLiteralValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" || typeof v === "bigint") {
    const s = String(v);
    // Ensure it's actually a numeric literal to prevent injection via crafted toString
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
    return `'${s.replace(/'/g, "''")}'`;
  }
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  // Objects/arrays: serialize as JSON string to avoid [object Object]
  return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
}

// ─── Inline strategy (MSSQL, DuckDB) ────────────────────────────────
// Values are escaped and embedded directly in SQL. No bind values.

function buildInlineWhereClause(
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): string {
  return primaryKeys.map((pk) => `${qi(pk)} = ${formatLiteralValue(row[pk])}`).join(" AND ");
}

export function buildInlineUpdate(
  schema: string,
  table: string,
  column: string,
  newValue: unknown,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const whereClause = buildInlineWhereClause(primaryKeys, row, qi);
  const sql = `UPDATE ${qi(schema)}.${qi(table)} SET ${qi(column)} = ${formatLiteralValue(newValue)} WHERE ${whereClause}`;
  return { sql };
}

export function buildInlineSetDefault(
  schema: string,
  table: string,
  column: string,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const whereClause = buildInlineWhereClause(primaryKeys, row, qi);
  const sql = `UPDATE ${qi(schema)}.${qi(table)} SET ${qi(column)} = DEFAULT WHERE ${whereClause}`;
  return { sql };
}

export function buildInlineInsert(
  schema: string,
  table: string,
  values: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const columns = Object.keys(values);
  const columnNames = columns.map((c) => qi(c)).join(", ");
  const valuesList = Object.values(values)
    .map((v) => formatLiteralValue(v))
    .join(", ");
  const sql = `INSERT INTO ${qi(schema)}.${qi(table)} (${columnNames}) VALUES (${valuesList})`;
  return { sql };
}

export function buildInlineDelete(
  schema: string,
  table: string,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const whereClause = buildInlineWhereClause(primaryKeys, row, qi);
  const sql = `DELETE FROM ${qi(schema)}.${qi(table)} WHERE ${whereClause}`;
  return { sql };
}

// ─── Parameterized strategy (Postgres, MySQL, SQLite) ────────────────
// Values use $N placeholders with a separate bindValues array.

function getCastPlaceholder(paramIndex: number, column: string, castLookup?: CastLookup): string {
  const placeholder = `$${paramIndex}`;
  if (!castLookup) return placeholder;
  const castType = castLookup(column);
  if (!castType) return placeholder;
  return `CAST(${placeholder} AS ${castType})`;
}

export function buildParamUpdate(
  schema: string,
  table: string,
  column: string,
  newValue: unknown,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
  castLookup?: CastLookup,
): SqlWithBindings {
  const valuePlaceholder = getCastPlaceholder(1, column, castLookup);
  const whereConditions = primaryKeys.map((pk, i) => `${qi(pk)} = $${i + 2}`);
  const sql = `UPDATE ${qi(schema)}.${qi(table)} SET ${qi(column)} = ${valuePlaceholder} WHERE ${whereConditions.join(" AND ")}`;
  const bindValues = [newValue, ...primaryKeys.map((pk) => row[pk])];
  return { sql, bindValues };
}

export function buildParamSetDefault(
  schema: string,
  table: string,
  column: string,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const whereConditions = primaryKeys.map((pk, i) => `${qi(pk)} = $${i + 1}`);
  const sql = `UPDATE ${qi(schema)}.${qi(table)} SET ${qi(column)} = DEFAULT WHERE ${whereConditions.join(" AND ")}`;
  const bindValues = primaryKeys.map((pk) => row[pk]);
  return { sql, bindValues };
}

export function buildParamInsert(
  schema: string,
  table: string,
  values: Record<string, unknown>,
  qi: QuoteIdFn,
  castLookup?: CastLookup,
): SqlWithBindings {
  const columns = Object.keys(values);
  const columnNames = columns.map((c) => qi(c)).join(", ");
  const placeholders = columns
    .map((col, i) => getCastPlaceholder(i + 1, col, castLookup))
    .join(", ");
  const sql = `INSERT INTO ${qi(schema)}.${qi(table)} (${columnNames}) VALUES (${placeholders})`;
  return { sql, bindValues: Object.values(values) };
}

export function buildParamDelete(
  schema: string,
  table: string,
  primaryKeys: string[],
  row: Record<string, unknown>,
  qi: QuoteIdFn,
): SqlWithBindings {
  const whereConditions = primaryKeys.map((pk, i) => `${qi(pk)} = $${i + 1}`);
  const sql = `DELETE FROM ${qi(schema)}.${qi(table)} WHERE ${whereConditions.join(" AND ")}`;
  const bindValues = primaryKeys.map((pk) => row[pk]);
  return { sql, bindValues };
}
