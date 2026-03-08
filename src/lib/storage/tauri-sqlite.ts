import Database from "@tauri-apps/plugin-sql";
import type { SqliteDatabase, SqliteProvider } from "./sqlite-types";

class TauriSqliteDatabase implements SqliteDatabase {
  constructor(private db: Database) {}

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const result = await this.db.execute(sql, params);
    return result?.rowsAffected ?? 0;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.select(sql, params) as Promise<T[]>;
  }

  async transaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.db.execute("BEGIN TRANSACTION");
    try {
      for (const stmt of statements) {
        await this.db.execute(stmt.sql, stmt.params);
      }
      await this.db.execute("COMMIT");
    } catch (error) {
      await this.db.execute("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close(this.db.path);
  }
}

export class TauriSqliteProvider implements SqliteProvider {
  readonly id = "tauri-sqlite";

  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
  }

  async open(path: string): Promise<SqliteDatabase> {
    const db = await Database.load(`sqlite:${path}`);
    return new TauriSqliteDatabase(db);
  }
}
