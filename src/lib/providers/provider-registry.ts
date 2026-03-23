/**
 * Centralized provider lifecycle manager.
 * Replaces duplicated getOrCreate/getProviderFor patterns across managers.
 */

import type { DatabaseProvider } from "./types";
import { getProvider, getDuckDBProvider } from "./index";
import { isTauri } from "$lib/utils/environment";

export class ProviderRegistry {
  private provider: DatabaseProvider | null = null;
  private duckdbProvider: DatabaseProvider | null = null;
  private webSqliteProvider: DatabaseProvider | null = null;

  /**
   * Get the appropriate provider for a given database type.
   * Lazily initializes and caches provider instances.
   */
  async getForType(dbType: string): Promise<DatabaseProvider> {
    // Browser-only providers for demo mode
    if (dbType === "sqlite" && !isTauri()) {
      return this.getOrCreateWebSqlite();
    }
    if (dbType === "duckdb" && !isTauri()) {
      return this.getOrCreateDuckDB();
    }
    // In Tauri, the unified provider handles all database types
    return this.getOrCreateDefault();
  }

  /**
   * Get or create the default database provider (PostgreSQL/SQLite).
   */
  async getOrCreateDefault(): Promise<DatabaseProvider> {
    if (!this.provider) {
      this.provider = await getProvider();
    }
    return this.provider;
  }

  /**
   * Get or create the DuckDB provider.
   */
  async getOrCreateDuckDB(): Promise<DatabaseProvider> {
    if (!this.duckdbProvider) {
      this.duckdbProvider = await getDuckDBProvider();
    }
    return this.duckdbProvider;
  }

  /**
   * Get or create the web SQLite provider (browser demo).
   */
  async getOrCreateWebSqlite(): Promise<DatabaseProvider> {
    if (!this.webSqliteProvider) {
      const { WebSqliteDatabaseProvider } = await import("./web-sqlite-provider");
      this.webSqliteProvider = new WebSqliteDatabaseProvider();
    }
    return this.webSqliteProvider;
  }

  /**
   * Reset cached provider instances.
   * Call on disconnect or cleanup.
   */
  reset(): void {
    this.provider = null;
    this.duckdbProvider = null;
    this.webSqliteProvider = null;
  }
}
