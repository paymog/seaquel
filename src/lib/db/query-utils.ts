export type QueryType = "select" | "insert" | "update" | "delete" | "other";

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
 * Returns true if the query is a write operation (INSERT, UPDATE, DELETE).
 */
export function isWriteQuery(query: string): boolean {
  const type = detectQueryType(query);
  return type === "insert" || type === "update" || type === "delete";
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
