import * as monaco from "monaco-editor";
import type { DatabaseType, SchemaTable } from "$lib/types";
import { getAdapter } from "$lib/db";

interface TableReference {
  table: SchemaTable;
  alias?: string;
}

/** Unquoted lowercase identifiers need no quoting; mixed case and special chars do. */
const SIMPLE_UNQUOTED_IDENT = /^[a-z_][a-z0-9_]*$/;

export function needsSchemaIdentQuoting(id: string): boolean {
  return !SIMPLE_UNQUOTED_IDENT.test(id);
}

export interface IdentifierQuoter {
  quoteSchemaIdent(id: string): string;
  /** Unquoted table aliases from the query — never wrap (avoids case-sensitive alias names). */
  quoteAlias(alias: string): string;
}

export function createIdentifierQuoter(databaseType: DatabaseType): IdentifierQuoter {
  const quoteFull = (id: string) => getAdapter(databaseType).quoteIdentifier(id);
  return {
    quoteSchemaIdent(id: string): string {
      return needsSchemaIdentQuoting(id) ? quoteFull(id) : id;
    },
    quoteAlias(alias: string): string {
      return alias;
    },
  };
}

/** Matches double-quoted, backtick-quoted, bracket-quoted, or bare word identifiers. */
export const QUOTED_IDENT = '(?:\\[[^\\]]+\\]|`[^`]+`|"[^"]+"|\\w+)';

export function unquoteIdent(id: string): string {
  if (id.startsWith('"') && id.endsWith('"')) {
    return id.slice(1, -1).replace(/""/g, '"');
  }
  if (id.startsWith("`") && id.endsWith("`")) {
    return id.slice(1, -1).replace(/``/g, "`");
  }
  if (id.startsWith("[") && id.endsWith("]")) {
    return id.slice(1, -1).replace(/\]\]/g, "]");
  }
  return id;
}

function tableColumnPrefix(ref: TableReference, quote: IdentifierQuoter): string {
  if (ref.alias) return quote.quoteAlias(ref.alias);
  return quote.quoteSchemaIdent(ref.table.name);
}

/**
 * Find all tables referenced in FROM and JOIN clauses
 */
function findTablesInQuery(queryText: string, schema: SchemaTable[]): TableReference[] {
  const tables: TableReference[] = [];

  // FROM clause: FROM [schema.]table [AS] [alias]
  const fromRegex = new RegExp(
    String.raw`FROM\s+(?:(${QUOTED_IDENT})\.)?(${QUOTED_IDENT})(?:\s+(?:AS\s+)?(\w+))?`,
    "gi",
  );
  let match;

  while ((match = fromRegex.exec(queryText)) !== null) {
    const schemaName = match[1] ? unquoteIdent(match[1]).toLowerCase() : undefined;
    const tableName = unquoteIdent(match[2]).toLowerCase();
    const alias = match[3];

    // Check if the "alias" is actually a SQL keyword (meaning no alias)
    const sqlKeywords = [
      "WHERE",
      "JOIN",
      "LEFT",
      "RIGHT",
      "INNER",
      "OUTER",
      "FULL",
      "CROSS",
      "ON",
      "ORDER",
      "GROUP",
      "HAVING",
      "LIMIT",
      "OFFSET",
      "UNION",
      "INTERSECT",
      "EXCEPT",
    ];
    const validAlias = alias && !sqlKeywords.includes(alias.toUpperCase()) ? alias : undefined;

    const tableMatch = schema.find(
      (t) =>
        t.name.toLowerCase() === tableName &&
        (!schemaName || t.schema.toLowerCase() === schemaName),
    );
    if (tableMatch) {
      tables.push({ table: tableMatch, alias: validAlias });
    }
  }

  // JOIN clause: [LEFT|RIGHT|...] JOIN [schema.]table [AS] [alias]
  const joinRegex = new RegExp(
    String.raw`JOIN\s+(?:(${QUOTED_IDENT})\.)?(${QUOTED_IDENT})(?:\s+(?:AS\s+)?(\w+))?`,
    "gi",
  );

  while ((match = joinRegex.exec(queryText)) !== null) {
    const schemaName = match[1] ? unquoteIdent(match[1]).toLowerCase() : undefined;
    const tableName = unquoteIdent(match[2]).toLowerCase();
    const alias = match[3];

    const sqlKeywords = ["ON", "WHERE", "AND", "OR", "LEFT", "RIGHT", "INNER"];
    const validAlias = alias && !sqlKeywords.includes(alias.toUpperCase()) ? alias : undefined;

    const tableMatch = schema.find(
      (t) =>
        t.name.toLowerCase() === tableName &&
        (!schemaName || t.schema.toLowerCase() === schemaName),
    );
    if (tableMatch && !tables.some((t) => t.table.name === tableMatch.name)) {
      tables.push({ table: tableMatch, alias: validAlias });
    }
  }

  return tables;
}

/**
 * Determine the current SQL clause context based on the last keyword before cursor
 */
function getCurrentClause(
  textBeforeCursor: string,
): "select" | "from" | "where" | "on" | "order" | "group" | "having" | "set" | "other" {
  const upper = textBeforeCursor.toUpperCase();

  // Find positions of all clause keywords
  const clauses: { clause: ReturnType<typeof getCurrentClause>; pos: number }[] = [];

  const patterns: [RegExp, ReturnType<typeof getCurrentClause>][] = [
    [/\bSELECT\b/gi, "select"],
    [/\bFROM\b/gi, "from"],
    [/\bWHERE\b/gi, "where"],
    [/\bON\b/gi, "on"],
    [/\bORDER\s+BY\b/gi, "order"],
    [/\bGROUP\s+BY\b/gi, "group"],
    [/\bHAVING\b/gi, "having"],
    [/\bSET\b/gi, "set"],
    [/\bJOIN\b/gi, "from"], // JOIN is part of FROM clause for table context
  ];

  for (const [pattern, clause] of patterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      clauses.push({ clause, pos: match.index });
    }
  }

  if (clauses.length === 0) return "other";

  // Return the clause with the highest position (closest to cursor)
  clauses.sort((a, b) => b.pos - a.pos);
  return clauses[0].clause;
}

/**
 * Check if cursor is in a context where column suggestions make sense
 */
function isColumnContext(textBeforeCursor: string): boolean {
  const clause = getCurrentClause(textBeforeCursor);

  // Column context: SELECT, WHERE, ON, ORDER BY, GROUP BY, HAVING, SET
  // Not column context: FROM (expects table names)
  return ["select", "where", "on", "order", "group", "having", "set"].includes(clause);
}

export function createSchemaCompletionProvider(
  getSchema: () => SchemaTable[],
  getDatabaseType: () => DatabaseType = () => "postgres",
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", " ", ","],

    provideCompletionItems(
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
      const schema = getSchema();
      const quote = createIdentifierQuoter(getDatabaseType());
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // Get full query text and text before cursor
      const fullQuery = model.getValue();
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);

      // Get all text before cursor position across all lines
      const textBeforeCursorFull = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions: monaco.languages.CompletionItem[] = [];

      // Check if we're after a table name or alias with dot (for column completion)
      const dotMatch = new RegExp(String.raw`(${QUOTED_IDENT})\.\s*$`).exec(textBeforeCursor);
      if (dotMatch) {
        const prefix = unquoteIdent(dotMatch[1]).toLowerCase();
        const referencedTables = findTablesInQuery(fullQuery, schema);

        // Find table by name or alias
        const tableRef = referencedTables.find(
          (ref) => ref.table.name.toLowerCase() === prefix || ref.alias?.toLowerCase() === prefix,
        );
        const table = tableRef?.table ?? schema.find((t) => t.name.toLowerCase() === prefix);

        if (table) {
          // Add column suggestions
          table.columns.forEach((col) => {
            const markers: string[] = [];
            if (col.isPrimaryKey) markers.push("PK");
            if (col.isForeignKey) markers.push("FK");
            if (!col.nullable) markers.push("NOT NULL");

            suggestions.push({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${col.type}${markers.length ? ` (${markers.join(", ")})` : ""}`,
              insertText: quote.quoteSchemaIdent(col.name),
              range,
            });
          });
          return { suggestions };
        }
      }

      // Find tables referenced in FROM/JOIN clauses
      const referencedTables = findTablesInQuery(fullQuery, schema);

      // Context-aware column completion: if tables are referenced and we're in a column context
      if (referencedTables.length > 0 && isColumnContext(textBeforeCursorFull)) {
        // Add * for select all
        suggestions.push({
          label: "*",
          kind: monaco.languages.CompletionItemKind.Constant,
          detail: "Select all columns",
          insertText: "*",
          range,
          sortText: "!0", // Sort first (! comes before letters/numbers)
        });

        // Add columns from all referenced tables
        referencedTables.forEach((ref) => {
          const prefixLabel = ref.alias ?? ref.table.name;
          const prefixInsert = tableColumnPrefix(ref, quote);
          const showPrefix = referencedTables.length > 1;

          ref.table.columns.forEach((col, idx) => {
            const markers: string[] = [];
            if (col.isPrimaryKey) markers.push("PK");
            if (col.isForeignKey) markers.push("FK");
            if (!col.nullable) markers.push("NOT NULL");

            const label = showPrefix ? `${prefixLabel}.${col.name}` : col.name;
            const insertText = showPrefix
              ? `${prefixInsert}.${quote.quoteSchemaIdent(col.name)}`
              : quote.quoteSchemaIdent(col.name);
            suggestions.push({
              label,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${ref.table.name}.${col.name} (${col.type}${markers.length ? `, ${markers.join(", ")}` : ""})`,
              insertText,
              range,
              sortText: `!1${String(idx).padStart(3, "0")}`, // Sort after *, before other suggestions
            });
          });
        });

        // When in column context, return early to only show column suggestions
        // This makes them much more prominent
        return { suggestions };
      }

      // Determine current clause context
      const currentClause = getCurrentClause(textBeforeCursorFull);

      // Add schema suggestions (unique schema names) - Group 0: Schemas
      const uniqueSchemas = [...new Set(schema.map((t) => t.schema))].sort();
      uniqueSchemas.forEach((schemaName, idx) => {
        suggestions.push({
          label: schemaName,
          kind: monaco.languages.CompletionItemKind.Folder,
          detail: "schema",
          insertText: quote.quoteSchemaIdent(schemaName),
          range,
          sortText: `0-schema-${String(idx).padStart(3, "0")}`,
        });
      });

      // Add table suggestions - Group 1: Tables
      const sortedTables = [...schema].sort((a, b) => a.name.localeCompare(b.name));
      sortedTables.forEach((table, idx) => {
        // Table name only
        suggestions.push({
          label: table.name,
          kind:
            table.type !== "table"
              ? monaco.languages.CompletionItemKind.Interface
              : monaco.languages.CompletionItemKind.Struct,
          detail: `${table.schema}.${table.name} (${table.type})`,
          insertText: quote.quoteSchemaIdent(table.name),
          range,
          sortText: `1-table-${String(idx).padStart(3, "0")}`,
        });

        // Schema-qualified table name
        suggestions.push({
          label: `${table.schema}.${table.name}`,
          kind:
            table.type !== "table"
              ? monaco.languages.CompletionItemKind.Interface
              : monaco.languages.CompletionItemKind.Struct,
          detail: table.columns.length ? `${table.columns.length} columns` : "",
          insertText: `${quote.quoteSchemaIdent(table.schema)}.${quote.quoteSchemaIdent(table.name)}`,
          range,
          sortText: `1-table-${String(idx).padStart(3, "0")}-qualified`,
        });
      });

      // In FROM context, only show table names (no keywords or types)
      if (currentClause === "from") {
        return { suggestions };
      }

      // Add SQL keywords
      const keywords = [
        "SELECT",
        "FROM",
        "WHERE",
        "JOIN",
        "LEFT JOIN",
        "RIGHT JOIN",
        "INNER JOIN",
        "FULL OUTER JOIN",
        "CROSS JOIN",
        "ON",
        "AND",
        "OR",
        "NOT",
        "IN",
        "LIKE",
        "ILIKE",
        "ORDER BY",
        "GROUP BY",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "INSERT INTO",
        "UPDATE",
        "DELETE FROM",
        "VALUES",
        "SET",
        "CREATE TABLE",
        "ALTER TABLE",
        "DROP TABLE",
        "AS",
        "DISTINCT",
        "COUNT",
        "SUM",
        "AVG",
        "MIN",
        "MAX",
        "CASE",
        "WHEN",
        "THEN",
        "ELSE",
        "END",
        "NULL",
        "IS NULL",
        "IS NOT NULL",
        "BETWEEN",
        "EXISTS",
        "UNION",
        "UNION ALL",
        "INTERSECT",
        "EXCEPT",
        "WITH",
        "RETURNING",
        "COALESCE",
        "NULLIF",
        "CAST",
        "ASC",
        "DESC",
      ];

      keywords.forEach((kw) => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
        });
      });

      // Add PostgreSQL types
      const pgTypes = [
        "integer",
        "bigint",
        "smallint",
        "serial",
        "bigserial",
        "text",
        "varchar",
        "char",
        "boolean",
        "date",
        "timestamp",
        "timestamptz",
        "time",
        "timetz",
        "interval",
        "uuid",
        "json",
        "jsonb",
        "numeric",
        "decimal",
        "real",
        "double precision",
        "bytea",
        "inet",
        "cidr",
        "macaddr",
      ];

      pgTypes.forEach((type) => {
        suggestions.push({
          label: type,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: type,
          range,
        });
      });

      return { suggestions };
    },
  };
}
