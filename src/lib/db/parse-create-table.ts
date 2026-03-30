import type {
  CreateTableDefinition,
  CreateTableColumn,
  CreateTableIndex,
  CreateTableForeignKey,
} from "$lib/types";

/**
 * Parse a CREATE TABLE SQL statement back into a CreateTableDefinition.
 * Handles PostgreSQL (double-quote), MySQL (backtick), MSSQL (square-bracket),
 * and unquoted identifier styles.
 *
 * This is best-effort: it covers the DDL our adapters generate and common hand-written SQL,
 * but is not a full SQL parser.
 */
export function parseCreateTableSql(sql: string): CreateTableDefinition | null {
  try {
    return doParse(sql);
  } catch {
    return null;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Strip one layer of quotes (double, backtick, or square bracket) from an identifier. */
function unquote(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("`") && s.endsWith("`"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1);
  }
  return s;
}

/** Match a possibly-quoted identifier. */
const ID = String.raw`(?:"[^"]+"|` + "`[^`]+" + "`" + String.raw`|\[[^\]]+\]|[A-Za-z_]\w*)`;

// ── main parser ─────────────────────────────────────────────────────────

function doParse(sql: string): CreateTableDefinition | null {
  // ── 1. Extract CREATE TABLE header ────────────────────────────────
  const createRe = new RegExp(
    String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?` + String.raw`(${ID})(?:\.(${ID}))?\s*\(`,
    "i",
  );
  const headerMatch = sql.match(createRe);
  if (!headerMatch) return null;

  let schemaName: string;
  let tableName: string;

  if (headerMatch[2]) {
    // schema.table
    schemaName = unquote(headerMatch[1]);
    tableName = unquote(headerMatch[2]);
  } else {
    schemaName = "public";
    tableName = unquote(headerMatch[1]);
  }

  // ── 2. Extract body between the outer ( … ) of CREATE TABLE ───────
  const bodyStart = sql.indexOf("(", headerMatch.index! + headerMatch[0].length - 1);
  const bodyEnd = findMatchingParen(sql, bodyStart);
  if (bodyEnd === -1) return null;

  const body = sql.slice(bodyStart + 1, bodyEnd);

  // ── 3. Split body into top-level comma-separated items ────────────
  const items = splitTopLevel(body);

  const columns: CreateTableColumn[] = [];
  const pkColumns = new Set<string>();
  const uniqueColumns = new Set<string>();
  const foreignKeys: CreateTableForeignKey[] = [];

  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;

    // ── Table-level PRIMARY KEY ───────────────────────────────────
    if (/^PRIMARY\s+KEY\b/i.test(item)) {
      const cols = extractParenList(item);
      for (const c of cols) pkColumns.add(c);
      continue;
    }

    // ── Table-level UNIQUE ────────────────────────────────────────
    if (/^UNIQUE\b/i.test(item)) {
      const cols = extractParenList(item);
      for (const c of cols) uniqueColumns.add(c);
      continue;
    }

    // ── Table-level FOREIGN KEY ───────────────────────────────────
    if (/^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\b/i.test(item)) {
      const fk = parseForeignKey(item);
      if (fk) foreignKeys.push(fk);
      continue;
    }

    // ── CHECK / CONSTRAINT (skip) ─────────────────────────────────
    if (/^(?:CONSTRAINT|CHECK)\b/i.test(item)) continue;

    // ── Column definition ─────────────────────────────────────────
    const col = parseColumnDef(item);
    if (col) columns.push(col);
  }

  // Apply table-level PK / UNIQUE back to columns
  for (const col of columns) {
    if (pkColumns.has(col.name)) {
      col.isPrimaryKey = true;
      col.nullable = false;
    }
    if (uniqueColumns.has(col.name)) {
      col.isUnique = true;
    }
  }

  // ── 4. Parse CREATE INDEX statements after the CREATE TABLE ───────
  const indexes: CreateTableIndex[] = [];
  const afterTable = sql.slice(bodyEnd + 1);
  const indexRe =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s+\S+(?:\.\S+)?\s*\(([^)]+)\)/gi;
  let idxMatch;
  while ((idxMatch = indexRe.exec(afterTable)) !== null) {
    const isUnique = !!idxMatch[1];
    const name = unquote(idxMatch[2]);
    const cols = idxMatch[3].split(",").map((c) => unquote(c.trim()));
    indexes.push({
      id: crypto.randomUUID(),
      name,
      columns: cols,
      unique: isUnique,
      type: "btree",
    });
  }

  return { tableName, schemaName, columns, indexes, foreignKeys };
}

// ── item parsers ────────────────────────────────────────────────────────

function parseColumnDef(item: string): CreateTableColumn | null {
  // Pattern: <name> <type> [constraints...]
  const idRe = new RegExp(`^(${ID})\\s+`, "i");
  const nameMatch = item.match(idRe);
  if (!nameMatch) return null;

  const name = unquote(nameMatch[1]);
  let rest = item.slice(nameMatch[0].length);

  // Extract type — everything up to the first constraint keyword or end
  const typeEnd = rest.search(
    /\b(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED|SERIAL)\b/i,
  );
  let typeStr: string;
  if (typeEnd === -1) {
    typeStr = rest.trim();
    rest = "";
  } else {
    typeStr = rest.slice(0, typeEnd).trim();
    rest = rest.slice(typeEnd);
  }

  // Remove trailing comma from type if present
  typeStr = typeStr.replace(/,$/, "").trim();

  // Parse type into base + length/precision
  let type = typeStr;
  let length: string | undefined;
  let precision: string | undefined;

  const parenMatch = typeStr.match(/^([^(]+)\(([^)]+)\)/);
  if (parenMatch) {
    type = parenMatch[1].trim();
    const params = parenMatch[2].trim();
    if (params.includes(",")) {
      precision = params;
    } else {
      length = params;
    }
  }

  // Parse constraints from the rest
  const upper = rest.toUpperCase();
  const nullable = !upper.includes("NOT NULL");
  const isPrimaryKey = /PRIMARY\s+KEY/i.test(rest);
  const isUnique = /\bUNIQUE\b/i.test(rest);

  let defaultValue = "";
  const defaultMatch = rest.match(
    /DEFAULT\s+(.+?)(?:\s+(?:NOT\s+NULL|NULL|PRIMARY|UNIQUE|CHECK|REFERENCES|CONSTRAINT|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED)|$)/i,
  );
  if (defaultMatch) {
    defaultValue = defaultMatch[1].trim().replace(/,$/, "").trim();
  }

  return {
    id: crypto.randomUUID(),
    name,
    type,
    length,
    precision,
    nullable: isPrimaryKey ? false : nullable,
    defaultValue,
    isPrimaryKey,
    isUnique,
  };
}

function parseForeignKey(item: string): CreateTableForeignKey | null {
  // FOREIGN KEY ("col") REFERENCES "schema"."table" ("col")
  // or FOREIGN KEY ("col") REFERENCES "table" ("col")
  const fkRe = new RegExp(
    String.raw`FOREIGN\s+KEY\s*\(\s*(${ID})\s*\)\s*REFERENCES\s+(${ID})(?:\.(${ID}))?\s*\(\s*(${ID})\s*\)`,
    "i",
  );
  const m = item.match(fkRe);
  if (!m) return null;

  let referencedSchema: string;
  let referencedTable: string;
  let referencedColumn: string;
  const column = unquote(m[1]);

  if (m[3]) {
    referencedSchema = unquote(m[2]);
    referencedTable = unquote(m[3]);
    referencedColumn = unquote(m[4]);
  } else {
    referencedSchema = "";
    referencedTable = unquote(m[2]);
    referencedColumn = unquote(m[4] ?? m[3] ?? "");
  }

  return {
    id: crypto.randomUUID(),
    column,
    referencedSchema,
    referencedTable,
    referencedColumn,
  };
}

// ── utility ─────────────────────────────────────────────────────────────

/** Find the index of the closing paren that matches the opening paren at `start`. */
function findMatchingParen(sql: string, start: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/** Split a string by commas, but only at the top level (not inside parentheses or quotes). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Extract the list of identifiers from the first parenthesised group. */
function extractParenList(s: string): string[] {
  const m = s.match(/\(([^)]+)\)/);
  if (!m) return [];
  return m[1].split(",").map((c) => unquote(c.trim()));
}
