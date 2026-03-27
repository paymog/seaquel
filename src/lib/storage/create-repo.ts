import type { SqliteDatabase } from "./sqlite-types";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Column definition types
// ---------------------------------------------------------------------------

/**
 * Describes how a single TypeScript property maps to/from a SQLite column.
 *
 * - `dbColumn`  — the snake_case column name in SQLite
 * - `toDb`      — convert a TS value to a SQLite parameter
 * - `fromDb`    — convert a SQLite row value to the TS property value
 */
export interface ColumnDef<TValue = unknown, TDb = unknown> {
  dbColumn: string;
  toDb: (value: TValue) => TDb;
  fromDb: (value: TDb) => TValue;
}

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

/** Pass-through — no transformation. */
export function col(dbColumn: string): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => v,
    fromDb: (v) => v,
  };
}

/** `null ↔ undefined` — maps SQL NULL to JS `undefined` and vice versa. */
export function nullable(dbColumn: string): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => v ?? null,
    fromDb: (v) => (v === null || v === undefined ? undefined : v),
  };
}

/** `0/1 ↔ boolean` — always defined (never undefined). */
export function bool(dbColumn: string): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => (v ? 1 : 0),
    fromDb: (v) => v === 1,
  };
}

/**
 * Optional boolean:
 * - `null/undefined → undefined` / `0/1 → boolean`  (fromDb)
 * - `undefined → null` / `boolean → 0/1`             (toDb)
 */
export function optBool(dbColumn: string): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => (v === undefined || v === null ? null : v ? 1 : 0),
    fromDb: (v) => (v === null || v === undefined ? undefined : v === 1),
  };
}

/** JSON column — `JSON.parse` on read, `JSON.stringify` on write. */
export function json<T>(dbColumn: string, fallback: T): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => (v === undefined || v === null ? null : JSON.stringify(v)),
    fromDb: (v) => (typeof v === "string" ? safeJsonParse(v, fallback) : (v ?? fallback)),
  };
}

// ---------------------------------------------------------------------------
// Schema & Repo types
// ---------------------------------------------------------------------------

/** Maps each TS property key to its column definition. */
export type RepoSchema<T> = {
  [K in keyof T]: ColumnDef;
};

/** The object returned by `createRepo`. */
export interface Repo<T> {
  /** The SQL table name. */
  readonly table: string;

  /** Pre-built `INSERT ... ON CONFLICT ... UPDATE` SQL. */
  readonly upsertSql: string;

  /** Pre-built `INSERT` SQL (no conflict clause). */
  readonly insertSql: string;

  /** Convert a raw SQLite row into a typed TS object. */
  mapRow(row: Record<string, unknown>): T;

  /** Convert a typed TS object into an ordered array of SQLite params. */
  toParams(item: T): unknown[];

  /** Load all rows from the table. */
  loadAll(db: SqliteDatabase): Promise<T[]>;

  /** Load rows matching a `WHERE` clause (e.g. `"project_id = ?"`). */
  loadBy(db: SqliteDatabase, where: string, params: unknown[]): Promise<T[]>;

  /** Load a single row matching a `WHERE` clause, or `null`. */
  loadOneBy(db: SqliteDatabase, where: string, params: unknown[]): Promise<T | null>;

  /** Upsert a single item (INSERT ... ON CONFLICT ... UPDATE). */
  save(db: SqliteDatabase, item: T): Promise<void>;

  /** Upsert multiple items, one at a time. */
  saveAll(db: SqliteDatabase, items: T[]): Promise<void>;

  /** Delete rows matching a `WHERE` clause. */
  removeBy(db: SqliteDatabase, where: string, params: unknown[]): Promise<void>;

  /** Delete a single row by its primary-key value. */
  remove(db: SqliteDatabase, id: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateRepoOptions<T> {
  /** SQLite table name. */
  table: string;
  /** Primary-key TS property name (used for `remove` and ON CONFLICT). */
  id: keyof T & string;
  /** Column definitions keyed by TS property name. */
  columns: RepoSchema<T>;
}

export function createRepo<T>(options: CreateRepoOptions<T>): Repo<T> {
  const { table, id, columns } = options;

  // Ordered list of TS keys (stable iteration order)
  const keys = Object.keys(columns) as (keyof T & string)[];
  const defs = keys.map((k) => columns[k]);

  const dbColumns = defs.map((d) => d.dbColumn);
  const idDef = columns[id];

  // Pre-build SQL ----------------------------------------------------------

  const columnList = dbColumns.join(", ");
  const placeholders = dbColumns.map(() => "?").join(", ");

  // ON CONFLICT update: every column except the primary key
  const updateClauses = defs
    .filter((d) => d.dbColumn !== idDef.dbColumn)
    .map((d) => `${d.dbColumn} = excluded.${d.dbColumn}`)
    .join(",\n         ");

  const upsertSql =
    `INSERT INTO ${table} (${columnList})\n` +
    `       VALUES (${placeholders})\n` +
    `       ON CONFLICT(${idDef.dbColumn}) DO UPDATE SET\n` +
    `         ${updateClauses}`;

  const insertSql = `INSERT INTO ${table} (${columnList})\n` + `       VALUES (${placeholders})`;

  // Helpers ----------------------------------------------------------------

  function mapRow(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = defs[i].fromDb(row[defs[i].dbColumn]);
    }
    return result as T;
  }

  function toParams(item: T): unknown[] {
    return keys.map((k, i) => defs[i].toDb((item as Record<string, unknown>)[k]));
  }

  // Repo methods -----------------------------------------------------------

  async function loadAll(db: SqliteDatabase): Promise<T[]> {
    const rows = await db.query(`SELECT ${columnList} FROM ${table}`);
    return rows.map(mapRow);
  }

  async function loadBy(db: SqliteDatabase, where: string, params: unknown[]): Promise<T[]> {
    const rows = await db.query(`SELECT ${columnList} FROM ${table} WHERE ${where}`, params);
    return rows.map(mapRow);
  }

  async function loadOneBy(
    db: SqliteDatabase,
    where: string,
    params: unknown[],
  ): Promise<T | null> {
    const rows = await db.query(`SELECT ${columnList} FROM ${table} WHERE ${where}`, params);
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  }

  async function save(db: SqliteDatabase, item: T): Promise<void> {
    await db.execute(upsertSql, toParams(item));
  }

  async function saveAll(db: SqliteDatabase, items: T[]): Promise<void> {
    for (const item of items) {
      await save(db, item);
    }
  }

  async function remove(db: SqliteDatabase, idValue: unknown): Promise<void> {
    await db.execute(`DELETE FROM ${table} WHERE ${idDef.dbColumn} = ?`, [idValue]);
  }

  async function removeBy(db: SqliteDatabase, where: string, params: unknown[]): Promise<void> {
    await db.execute(`DELETE FROM ${table} WHERE ${where}`, params);
  }

  return {
    table,
    upsertSql,
    insertSql,
    mapRow,
    toParams,
    loadAll,
    loadBy,
    loadOneBy,
    save,
    saveAll,
    remove,
    removeBy,
  };
}
