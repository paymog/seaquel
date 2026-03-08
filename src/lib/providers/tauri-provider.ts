/**
 * Tauri database provider.
 * Wraps tauri-plugin-sql for PostgreSQL and SQLite connections in the desktop app.
 */

import Database from "@tauri-apps/plugin-sql";
import type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";
import type { SqliteDatabase } from "$lib/storage/sqlite-types";

/**
 * Database provider that uses Tauri's SQL plugin.
 * Supports PostgreSQL and SQLite via connection strings.
 */
export class TauriDatabaseProvider implements DatabaseProvider {
  readonly id = "tauri";

  /** Map of connection IDs to Database instances */
  private connections = new Map<string, Database>();
  /** Connections that reuse the internal SqliteDatabase instance */
  private internalConnections = new Map<string, SqliteDatabase>();

  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
  }

  private isInternalDb(config: ConnectionConfig): boolean {
    return (
      config.type === "sqlite" &&
      (config.databaseName?.includes("seaquel.db") ||
        config.connectionString?.includes("seaquel.db")) === true
    );
  }

  async connect(config: ConnectionConfig): Promise<string> {
    if (!config.connectionString) {
      throw new Error("Connection string is required for Tauri provider");
    }

    const connectionId = `tauri-${config.type}-${Date.now()}`;

    // For the internal database, reuse the already-open instance
    if (this.isInternalDb(config)) {
      const { getDatabase } = await import("$lib/storage/db");
      const db = await getDatabase();
      this.internalConnections.set(connectionId, db);
      return connectionId;
    }

    const db = await Database.load(config.connectionString);
    this.connections.set(connectionId, db);
    return connectionId;
  }

  async disconnect(connectionId: string): Promise<void> {
    // Don't close the internal database — it's shared with persistence
    if (this.internalConnections.has(connectionId)) {
      this.internalConnections.delete(connectionId);
      return;
    }

    const db = this.connections.get(connectionId);
    if (db) {
      await db.close(db.path);
      this.connections.delete(connectionId);
    }
  }

  async select<T = Record<string, unknown>>(
    connectionId: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const internalDb = this.internalConnections.get(connectionId);
    if (internalDb) {
      return internalDb.query<T>(sql, params);
    }

    const db = this.connections.get(connectionId);
    if (!db) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    return db.select(sql, params) as Promise<T[]>;
  }

  async execute(connectionId: string, sql: string, params?: unknown[]): Promise<ExecuteResult> {
    const internalDb = this.internalConnections.get(connectionId);
    if (internalDb) {
      const rowsAffected = await internalDb.execute(sql, params);
      return { rowsAffected };
    }

    const db = this.connections.get(connectionId);
    if (!db) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    const result = await db.execute(sql, params);
    return {
      rowsAffected: result?.rowsAffected ?? 0,
      lastInsertId: result?.lastInsertId,
    };
  }

  async test(config: ConnectionConfig): Promise<void> {
    if (!config.connectionString) {
      throw new Error("Connection string is required for Tauri provider");
    }
    const db = await Database.load(config.connectionString);
    await db.close(db.path);
  }

  /**
   * Get the underlying Database instance for a connection.
   * Used for backward compatibility during migration.
   */
  getDatabase(connectionId: string): Database | undefined {
    return this.connections.get(connectionId);
  }
}
