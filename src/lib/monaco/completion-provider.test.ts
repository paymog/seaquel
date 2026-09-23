import { describe, it, expect, vi } from "vitest";
import type { DatabaseType, SchemaTable } from "$lib/types";

vi.mock("monaco-editor", () => ({
  languages: {
    CompletionItemKind: {
      Field: 1,
      Struct: 2,
      Interface: 3,
      Folder: 4,
      Constant: 5,
      Keyword: 6,
      TypeParameter: 7,
    },
  },
}));

import { createSchemaCompletionProvider } from "./completion-provider";

const demoSchema: SchemaTable[] = [
  {
    name: "users",
    schema: "public",
    type: "table",
    columns: [
      {
        name: "id",
        type: "integer",
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
      },
      {
        name: "userId",
        type: "varchar",
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
      },
    ],
    indexes: [],
  },
  {
    name: "orders",
    schema: "public",
    type: "table",
    columns: [
      {
        name: "id",
        type: "integer",
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
      },
    ],
    indexes: [],
  },
];

function createMockModel(value: string, position: { lineNumber: number; column: number }) {
  const lines = value.split("\n");
  return {
    getValue: () => value,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
    getWordUntilPosition: () => ({
      startColumn: position.column,
      endColumn: position.column,
    }),
    getValueInRange: (range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }) => {
      let result = "";
      for (let ln = range.startLineNumber; ln <= range.endLineNumber; ln++) {
        const line = lines[ln - 1] ?? "";
        const start = ln === range.startLineNumber ? range.startColumn - 1 : 0;
        const end = ln === range.endLineNumber ? range.endColumn - 1 : line.length;
        result += line.slice(start, end);
        if (ln < range.endLineNumber) result += "\n";
      }
      return result;
    },
  };
}

function getSuggestions(
  sql: string,
  line: number,
  column: number,
  databaseType: DatabaseType,
  schema: SchemaTable[] = demoSchema,
) {
  const provider = createSchemaCompletionProvider(
    () => schema,
    () => databaseType,
  );
  const model = createMockModel(sql, { lineNumber: line, column });
  const result = provider.provideCompletionItems!(
    model as never,
    { lineNumber: line, column } as never,
    {} as never,
    {} as never,
  );
  if (!result || !("suggestions" in result) || !result.suggestions) return [];
  return result.suggestions;
}

describe("createSchemaCompletionProvider", () => {
  it("quotes mixed-case columns with MySQL backticks after an uppercase alias", () => {
    const sql = "SELECT  FROM users u JOIN orders o ON u.";
    const column = sql.length + 1;
    const suggestions = getSuggestions(sql, 1, column, "mysql");
    const userId = suggestions.find((s) => s.label === "userId");
    expect(userId?.insertText).toBe("`userId`");
  });

  it("does not quote uppercase table aliases in multi-table SELECT column inserts (MySQL)", () => {
    const sql = "SELECT  FROM users U JOIN orders O ON U.id = O.id WHERE ";
    const column = sql.length + 1;
    const suggestions = getSuggestions(sql, 1, column, "mysql");
    const userId = suggestions.find((s) => s.label === "U.userId");
    expect(userId?.insertText).toBe("U.`userId`");
  });

  it("does not quote uppercase table aliases but still quotes mixed-case columns (PostgreSQL)", () => {
    const sql = "SELECT  FROM users U JOIN orders O ON U.id = O.id WHERE ";
    const column = sql.length + 1;
    const suggestions = getSuggestions(sql, 1, column, "postgres");
    const userId = suggestions.find((s) => s.label === "U.userId");
    expect(userId?.insertText).toBe('U."userId"');
    const idCol = suggestions.find((s) => s.label === "U.id");
    expect(idCol?.insertText).toBe("U.id");
  });

  it("uses dialect quoting for mixed-case schema columns after alias dot (PostgreSQL)", () => {
    const sql = "SELECT  FROM users u WHERE u.";
    const column = sql.length + 1;
    const suggestions = getSuggestions(sql, 1, column, "postgres");
    const userId = suggestions.find((s) => s.label === "userId");
    expect(userId?.insertText).toBe('"userId"');
  });

  it("uses backticks for mixed-case table names in FROM completions (MySQL)", () => {
    const mixedCaseSchema: SchemaTable[] = [
      {
        name: "UserAccounts",
        schema: "app",
        type: "table",
        columns: [
          {
            name: "id",
            type: "integer",
            nullable: false,
            isPrimaryKey: true,
            isForeignKey: false,
          },
        ],
        indexes: [],
      },
    ];
    const sql = "SELECT * FROM ";
    const column = sql.length + 1;
    const suggestions = getSuggestions(sql, 1, column, "mysql", mixedCaseSchema);
    const table = suggestions.find((s) => s.label === "UserAccounts");
    expect(table?.insertText).toBe("`UserAccounts`");
  });
});
