/**
 * Unified Tauri database provider.
 * Single provider for all database types (PostgreSQL, MySQL, SQLite, MSSQL, DuckDB)
 * via the unified db_connect/db_query/db_execute/db_disconnect/db_test commands.
 */

import { invoke } from "@tauri-apps/api/core";
import type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";

interface DbConnectResult {
  connection_id: string;
}

interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
}

interface DbExecuteResult {
  rows_affected: number;
  last_insert_id: number | null;
}

interface DbError {
  message: string;
  code: string;
}

function isDbError(error: unknown): error is DbError {
  return typeof error === "object" && error !== null && "message" in error && "code" in error;
}

function formatError(error: unknown): Error {
  if (isDbError(error)) {
    return new Error(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("An unknown error occurred");
}

export class UnifiedTauriProvider implements DatabaseProvider {
  readonly id = "unified-tauri";

  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
  }

  async connect(config: ConnectionConfig): Promise<string> {
    try {
      const result = await invoke<DbConnectResult>("db_connect", {
        config: this.toRustConfig(config),
      });
      return result.connection_id;
    } catch (error) {
      throw formatError(error);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    try {
      await invoke("db_disconnect", { connectionId });
    } catch (error) {
      throw formatError(error);
    }
  }

  async select<T = Record<string, unknown>>(
    connectionId: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    try {
      const result = await invoke<DbQueryResult>("db_query", {
        connectionId,
        sql,
        values: params ?? [],
      });
      // Convert columnar → row objects for frontend compatibility
      return result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj as T;
      });
    } catch (error) {
      throw formatError(error);
    }
  }

  async execute(connectionId: string, sql: string, params?: unknown[]): Promise<ExecuteResult> {
    try {
      const result = await invoke<DbExecuteResult>("db_execute", {
        connectionId,
        sql,
        values: params ?? [],
      });
      return {
        rowsAffected: result.rows_affected,
        lastInsertId: result.last_insert_id ?? undefined,
      };
    } catch (error) {
      throw formatError(error);
    }
  }

  async test(config: ConnectionConfig): Promise<void> {
    try {
      await invoke("db_test", { config: this.toRustConfig(config) });
    } catch (error) {
      throw formatError(error);
    }
  }

  private toRustConfig(config: ConnectionConfig): Record<string, unknown> {
    if (config.type === "mssql") {
      return {
        driver: "mssql",
        host: config.host,
        port: config.port,
        database: config.databaseName,
        username: config.username,
        password: config.password,
        encrypt: config.sslMode !== "disable",
        trust_cert: config.sslMode !== "require",
      };
    }

    if (config.type === "duckdb") {
      const path = config.connectionString
        ? config.connectionString.replace(/^duckdb:\/\//, "").replace(/^duckdb:/, "") || ":memory:"
        : config.databaseName || ":memory:";
      return { driver: "duckdb", path };
    }

    // PostgreSQL, MySQL, MariaDB, SQLite
    return {
      driver: config.type === "mariadb" ? "mysql" : config.type,
      connection_string: config.connectionString,
    };
  }
}
