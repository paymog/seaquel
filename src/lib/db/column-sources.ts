/**
 * Derive per-column source-table info from a SELECT query using its AST.
 *
 * Inline cell editing in the query-result viewer needs to know which underlying
 * table+column each output column came from, so an edit to a JOIN'd column like
 * `SELECT a.id, b.id FROM orders a JOIN order_items b` goes to the right table
 * even though display names are disambiguated to `id` / `id_2`.
 */
import { Parser } from "node-sql-parser";
import type { ColumnSourceInfo, DatabaseType, SchemaTable } from "$lib/types";

// Separate parser instance — node-sql-parser's Parser holds no per-call state
// worth sharing, and keeping this isolated avoids coupling to sql-ast-parser.ts.
const parser = new Parser();

const DIALECT_MAP: Record<DatabaseType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  mssql: "TransactSQL",
  duckdb: "PostgreSQL",
};

interface FromEntry {
  schema?: string;
  table: string;
  alias?: string;
}

/**
 * Look up a table by (schema, name) in the cached schemas list. When `schema`
 * is unspecified the first table matching by name wins — same fallback the
 * rest of the codebase uses when the query doesn't qualify a table.
 */
function findTable(schemas: SchemaTable[], name: string, schema?: string): SchemaTable | undefined {
  if (schema) {
    return schemas.find((t) => t.name === name && t.schema === schema);
  }
  return schemas.find((t) => t.name === name);
}

/**
 * Read a column name from a `column_ref` AST node.
 *
 * node-sql-parser 5.x wraps column names in `{ expr: { type: 'default', value: 'id' } }`
 * for some dialects while emitting bare strings for others. Accept both shapes
 * so our resolution survives minor parser/dialect variation.
 */
function readColumnName(column: unknown): string | undefined {
  if (typeof column === "string") return column;
  if (column && typeof column === "object") {
    const expr = (column as Record<string, unknown>).expr;
    if (expr && typeof expr === "object") {
      const value = (expr as Record<string, unknown>).value;
      if (typeof value === "string") return value;
    }
    const value = (column as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function buildFromList(fromClause: unknown): FromEntry[] {
  if (!Array.isArray(fromClause)) return [];
  const out: FromEntry[] = [];
  for (const item of fromClause as Array<Record<string, unknown>>) {
    // Skip DUAL / subqueries / anything without a plain table reference —
    // we only reason about base-table columns.
    const table = typeof item.table === "string" ? item.table : undefined;
    if (!table) continue;
    const db = typeof item.db === "string" && item.db ? item.db : undefined;
    const as = typeof item.as === "string" && item.as ? item.as : undefined;
    out.push({ schema: db, table, alias: as });
  }
  return out;
}

/**
 * Resolve per-column source info for a SELECT query.
 *
 * Returns `undefined` when we can't confidently map columns — unparseable SQL,
 * non-SELECT statements, subqueries in FROM, `SELECT *` / `t.*` (column count
 * would depend on runtime schema), or a projection/column-count mismatch.
 *
 * On success, the returned array is parallel to the query's output columns:
 * index `i` describes output column `i`. Entries for computed expressions,
 * aggregates, or literals are `undefined` (those columns aren't editable).
 */
export function resolveColumnSources(
  query: string,
  dbType: DatabaseType,
  schemas: SchemaTable[],
): (ColumnSourceInfo | undefined)[] | undefined {
  let ast: unknown;
  try {
    const dialect = DIALECT_MAP[dbType] || "PostgreSQL";
    ast = parser.astify(query, { database: dialect });
  } catch {
    return undefined;
  }

  const statement = Array.isArray(ast) ? ast[0] : ast;
  if (!statement || typeof statement !== "object") return undefined;
  const stmt = statement as Record<string, unknown>;
  if (stmt.type !== "select") return undefined;

  // `SELECT *` is represented as the literal string "*" at the top of `columns`.
  // We bail here rather than guessing column order against cached schema — the
  // caller will fall back to the single `sourceTable` routing.
  const columns = stmt.columns;
  if (!Array.isArray(columns)) return undefined;

  const fromList = buildFromList(stmt.from);
  if (fromList.length === 0) return undefined;

  // Build alias/name → FromEntry map. Each from entry is reachable by its
  // alias (when present) and by its table name; later entries win on name
  // collision, same as SQL itself.
  const nameMap = new Map<string, FromEntry>();
  for (const entry of fromList) {
    if (entry.alias) nameMap.set(entry.alias, entry);
    nameMap.set(entry.table, entry);
  }

  const result: (ColumnSourceInfo | undefined)[] = [];

  for (const col of columns as Array<Record<string, unknown>>) {
    const expr = col.expr as Record<string, unknown> | undefined;
    if (!expr || expr.type !== "column_ref") {
      // Function call, aggregate, literal, CASE, etc. — not a base-table column.
      result.push(undefined);
      continue;
    }
    const columnName = readColumnName(expr.column);
    // A star inside the SELECT list (e.g. `a.*`) blows up our positional
    // alignment — punt on the whole query and let the caller fall back.
    if (!columnName || columnName === "*") return undefined;

    const tableRef = typeof expr.table === "string" && expr.table ? expr.table : undefined;
    let from: FromEntry | undefined;
    if (tableRef) {
      from = nameMap.get(tableRef);
    } else if (fromList.length === 1) {
      // Unqualified column in a single-table query is unambiguous.
      from = fromList[0];
    } else {
      // Unqualified column in a multi-table query — we'd need column-list
      // disambiguation against each table's schema. Skip rather than guess.
      result.push(undefined);
      continue;
    }

    if (!from) {
      result.push(undefined);
      continue;
    }

    const schemaTable = findTable(schemas, from.table, from.schema);
    if (!schemaTable) {
      result.push(undefined);
      continue;
    }
    const primaryKeys = schemaTable.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    // A source with no PKs can't support row-bound edits anyway — mark
    // undefined so the UI treats the column as read-only.
    if (primaryKeys.length === 0) {
      result.push(undefined);
      continue;
    }

    result.push({
      schema: schemaTable.schema,
      table: schemaTable.name,
      primaryKeys,
      column: columnName,
    });
  }

  return result;
}
