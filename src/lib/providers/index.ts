/**
 * Database provider factory.
 * Returns the appropriate provider based on the runtime environment.
 */

import type { DatabaseProvider } from "./types";
import { isTauri, isServer } from "$lib/utils/environment";

export type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";

let provider: DatabaseProvider | null = null;
let duckdbProvider: DatabaseProvider | null = null;

/**
 * Get the database provider for the current environment.
 * Returns TauriDatabaseProvider in desktop app, DuckDBProvider in browser.
 */
export async function getProvider(): Promise<DatabaseProvider> {
  if (provider) return provider;

  if (isTauri()) {
    // Platform-specific: @tauri-apps/api is unavailable in browser builds
    const { UnifiedTauriProvider } = await import("./unified-tauri-provider");
    provider = new UnifiedTauriProvider();
  } else if (isServer()) {
    // Platform-specific: server build serves the SPA from the Rust backend
    const { HttpDatabaseProvider } = await import("./http-provider");
    provider = new HttpDatabaseProvider();
  } else {
    // Platform-specific: DuckDB WASM is too heavy for non-demo builds
    const { DuckDBProvider } = await import("./duckdb-provider");
    provider = new DuckDBProvider();
  }

  return provider;
}

/**
 * Get the DuckDB provider for the current environment.
 * Returns DuckDBTauriProvider in desktop app, DuckDBProvider (WASM) in browser.
 */
export async function getDuckDBProvider(): Promise<DatabaseProvider> {
  if (duckdbProvider) return duckdbProvider;

  if (isTauri()) {
    // Platform-specific: @tauri-apps/api is unavailable in browser builds
    const { UnifiedTauriProvider } = await import("./unified-tauri-provider");
    duckdbProvider = new UnifiedTauriProvider();
  } else if (isServer()) {
    // Platform-specific: server backend handles DuckDB connections too
    const { HttpDatabaseProvider } = await import("./http-provider");
    duckdbProvider = new HttpDatabaseProvider();
  } else {
    // Platform-specific: DuckDB WASM is too heavy for non-demo builds
    const { DuckDBProvider } = await import("./duckdb-provider");
    duckdbProvider = new DuckDBProvider();
  }

  return duckdbProvider;
}

/**
 * Check if we're in demo mode (browser, not Tauri).
 */
export function isDemo(): boolean {
  return !isTauri() && !isServer();
}

/**
 * Reset the provider instance.
 * Mainly useful for testing.
 */
export function resetProvider(): void {
  provider = null;
  duckdbProvider = null;
}

export { ProviderRegistry } from "./provider-registry";
