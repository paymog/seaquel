import type { SqliteDatabase, SqliteProvider } from "./sqlite-types";
import type { Database, BindParams } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

const LOCALSTORAGE_KEY = "seaquel_db";

class WebSqliteDatabase implements SqliteDatabase {
  constructor(private db: Database) {}

  async execute(sql: string, params?: unknown[]): Promise<number> {
    this.db.run(sql, params as BindParams);
    this.persistToLocalStorage();
    return this.db.getRowsModified();
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (params) {
      stmt.bind(params as BindParams);
    }
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  async transaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    this.db.run("BEGIN TRANSACTION");
    try {
      for (const stmt of statements) {
        this.db.run(stmt.sql, stmt.params as BindParams);
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
    this.persistToLocalStorage();
  }

  async close(): Promise<void> {
    this.persistToLocalStorage();
    this.db.close();
  }

  private persistToLocalStorage(): void {
    try {
      const data = this.db.export();
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < data.length; i += chunkSize) {
        binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      localStorage.setItem(LOCALSTORAGE_KEY, base64);
    } catch (error) {
      console.error("Failed to persist SQLite to localStorage:", error);
    }
  }
}

export class WebSqliteProvider implements SqliteProvider {
  readonly id = "web-sqlite";

  isAvailable(): boolean {
    try {
      return typeof window !== "undefined" && typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  }

  async open(_path: string): Promise<SqliteDatabase> {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: () => sqlWasmUrl,
    });

    // Try to restore from localStorage
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    let db: Database;

    if (stored) {
      try {
        const binary = atob(stored);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        db = new SQL.Database(bytes);
      } catch {
        console.warn("Failed to restore SQLite from localStorage, creating new database");
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    return new WebSqliteDatabase(db);
  }
}
