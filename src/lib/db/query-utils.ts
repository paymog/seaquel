import type { ParsedStatement } from "./sql-parser";

export type QueryType = "select" | "insert" | "update" | "delete" | "other";

export type DestructiveReason =
  | "drop_table"
  | "drop_index"
  | "drop_view"
  | "drop_schema"
  | "drop_database"
  | "drop_column"
  | "truncate"
  | "delete_no_where"
  | "update_no_where";

export interface DestructiveStatement {
  sql: string;
  index: number;
  reason: DestructiveReason;
}

/**
 * Strips leading SQL comments (block and line) from a string.
 */
function stripLeadingComments(sql: string): string {
  let s = sql;
  while (true) {
    s = s.trimStart();
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end === -1) break;
      s = s.slice(end + 2);
    } else if (s.startsWith("--")) {
      const end = s.indexOf("\n");
      if (end === -1) break;
      s = s.slice(end + 1);
    } else {
      break;
    }
  }
  return s;
}

/**
 * Detects the type of SQL query based on its first keyword.
 */
export function detectQueryType(query: string): QueryType {
  const trimmed = stripLeadingComments(query).toUpperCase();
  if (trimmed.startsWith("SELECT")) return "select";
  if (trimmed.startsWith("INSERT")) return "insert";
  if (trimmed.startsWith("UPDATE")) return "update";
  if (trimmed.startsWith("DELETE")) return "delete";
  return "other";
}

/**
 * Returns true if the query is a SELECT statement.
 */
export function isSelectQuery(query: string): boolean {
  return detectQueryType(query) === "select";
}

/**
 * Extracts the table name from a simple SELECT query.
 * Returns null if the table cannot be determined.
 */
export function extractTableFromSelect(query: string): { schema?: string; table: string } | null {
  // Match: FROM [schema.]table
  // Handles: FROM table, FROM schema.table, FROM "table", FROM schema."table"
  const match = query.match(/\bFROM\s+(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?/i);
  if (!match) return null;
  return {
    schema: match[1] || undefined,
    table: match[2],
  };
}

/**
 * Checks if a SQL statement is destructive (could cause irreversible data/schema loss).
 * Returns the reason if destructive, null otherwise.
 */
export function isDestructiveStatement(sql: string): DestructiveReason | null {
  const stripped = stripLeadingComments(sql).trim();
  const upper = stripped.toUpperCase();

  if (/^DROP\s+TABLE\b/i.test(stripped)) return "drop_table";
  if (/^DROP\s+INDEX\b/i.test(stripped)) return "drop_index";
  if (/^DROP\s+VIEW\b/i.test(stripped)) return "drop_view";
  if (/^DROP\s+SCHEMA\b/i.test(stripped)) return "drop_schema";
  if (/^DROP\s+DATABASE\b/i.test(stripped)) return "drop_database";
  if (/^TRUNCATE\b/i.test(stripped)) return "truncate";
  if (/^ALTER\s+TABLE\b/i.test(stripped) && /\bDROP\s+COLUMN\b/i.test(upper)) return "drop_column";
  // DELETE/UPDATE can be preceded by a CTE: WITH x AS (...) DELETE FROM ...
  if (/(?:^|\)\s*)DELETE\b/i.test(stripped) && !/\bWHERE\b/i.test(upper)) return "delete_no_where";
  if (/(?:^|\)\s*)UPDATE\b/i.test(stripped) && !/\bWHERE\b/i.test(upper)) return "update_no_where";

  return null;
}

/**
 * Finds all destructive statements in a batch of parsed SQL statements.
 */
export function findDestructiveStatements(statements: ParsedStatement[]): DestructiveStatement[] {
  const results: DestructiveStatement[] = [];
  for (const stmt of statements) {
    const reason = isDestructiveStatement(stmt.sql);
    if (reason) {
      results.push({ sql: stmt.sql, index: stmt.index, reason });
    }
  }
  return results;
}
