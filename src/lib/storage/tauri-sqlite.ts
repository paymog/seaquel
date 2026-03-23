import { invoke } from "@tauri-apps/api/core";
import type { SqliteDatabase, SqliteProvider } from "./sqlite-types";

interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
}

interface DbExecuteResult {
  rows_affected: number;
  last_insert_id: number | null;
}

interface DbConnectResult {
  connection_id: string;
}

class TauriSqliteDatabase implements SqliteDatabase {
  constructor(private connectionId: string) {}

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const result = await invoke<DbExecuteResult>("db_execute", {
      connectionId: this.connectionId,
      sql,
      values: params ?? [],
    });
    return result.rows_affected;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await invoke<DbQueryResult>("db_query", {
      connectionId: this.connectionId,
      sql,
      values: params ?? [],
    });
    // Convert columnar → row objects for backward compatibility
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  async transaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.execute("BEGIN TRANSACTION");
    try {
      for (const stmt of statements) {
        await this.execute(stmt.sql, stmt.params);
      }
      await this.execute("COMMIT");
    } catch (error) {
      await this.execute("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    await invoke("db_disconnect", { connectionId: this.connectionId });
  }
}

export class TauriSqliteProvider implements SqliteProvider {
  readonly id = "tauri-sqlite";

  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
  }

  async open(path: string): Promise<SqliteDatabase> {
    const result = await invoke<DbConnectResult>("db_connect", {
      config: {
        driver: "sqlite",
        connection_string: `sqlite:${path}`,
      },
    });
    return new TauriSqliteDatabase(result.connection_id);
  }
}
