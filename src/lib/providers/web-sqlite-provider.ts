/**
 * Web SQLite database provider.
 * Wraps sql.js (WASM) to provide SQLite connections in the browser.
 * Used in demo mode for connecting to the internal seaquel.db.
 */

import type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";
import type { SqliteDatabase } from "$lib/storage/sqlite-types";

export class WebSqliteDatabaseProvider implements DatabaseProvider {
  readonly id = "web-sqlite";

  private connections = new Map<string, SqliteDatabase>();

  isAvailable(): boolean {
    return typeof window !== "undefined" && !("__TAURI__" in window);
  }

  async connect(config: ConnectionConfig): Promise<string> {
    const connectionId = `web-sqlite-${Date.now()}`;

    // For the internal database, reuse the already-open instance
    if (config.databaseName === "seaquel.db" || config.connectionString?.includes("seaquel.db")) {
      const { getDatabase } = await import("$lib/storage/db");
      const db = await getDatabase();
      this.connections.set(connectionId, db);
      return connectionId;
    }

    // For other SQLite databases, open a new sql.js instance
    const { WebSqliteProvider } = await import("$lib/storage/web-sqlite");
    const provider = new WebSqliteProvider();
    const db = await provider.open(config.databaseName);
    this.connections.set(connectionId, db);

    return connectionId;
  }

  async disconnect(connectionId: string): Promise<void> {
    // Don't close the internal database - it's shared
    this.connections.delete(connectionId);
  }

  async select<T = Record<string, unknown>>(
    connectionId: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const db = this.connections.get(connectionId);
    if (!db) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    return db.query<T>(sql, params);
  }

  async execute(connectionId: string, sql: string, params?: unknown[]): Promise<ExecuteResult> {
    const db = this.connections.get(connectionId);
    if (!db) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    const rowsAffected = await db.execute(sql, params);
    return { rowsAffected };
  }

  async test(config: ConnectionConfig): Promise<void> {
    const connId = await this.connect(config);
    await this.select(connId, "SELECT 1");
    await this.disconnect(connId);
  }
}
