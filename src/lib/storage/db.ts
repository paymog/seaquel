import type { SqliteDatabase } from "./sqlite-types";
import { isTauri } from "$lib/utils/environment";
import { initializeSchema, CURRENT_STORAGE_VERSION } from "./schema";

let instance: SqliteDatabase | null = null;
let initPromise: Promise<SqliteDatabase> | null = null;

export async function getDatabase(): Promise<SqliteDatabase> {
  if (instance) return instance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      let db: SqliteDatabase;

      if (isTauri()) {
        const { getDataDir } = await import("$lib/api/tauri");
        const { TauriSqliteProvider } = await import("./tauri-sqlite");
        const provider = new TauriSqliteProvider();
        const dataDir = await getDataDir();
        db = await provider.open(`${dataDir}/seaquel.db`);
      } else {
        const { WebSqliteProvider } = await import("./web-sqlite");
        const provider = new WebSqliteProvider();
        db = await provider.open("seaquel.db");
      }

      // Enable WAL mode and foreign keys
      await db.execute("PRAGMA journal_mode=WAL");
      await db.execute("PRAGMA foreign_keys=ON");

      // Initialize schema (returns true if this is a fresh database)
      const isFreshDb = await initializeSchema(db);

      if (isFreshDb) {
        // Fresh database — try migrating from legacy JSON files
        const { migrateJsonToSqlite } = await import("./json-migration");
        await migrateJsonToSqlite(db);

        // Record current storage version so data migrations are skipped (DDL is already up-to-date)
        await db.execute("INSERT INTO schema_version (version) VALUES (?)", [
          CURRENT_STORAGE_VERSION,
        ]);
      } else {
        // Existing database — check if connections are empty (failed prior migration)
        // and re-attempt migration from JSON if legacy files still exist
        const rows = await db.query<{ count: number }>("SELECT COUNT(*) as count FROM connections");
        if (rows[0].count === 0) {
          const { migrateJsonToSqlite } = await import("./json-migration");
          await migrateJsonToSqlite(db);
        }
      }

      instance = db;
      return db;
    } catch (error) {
      // Reset so the next call retries instead of returning the same rejection
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export function resetDatabase(): void {
  instance = null;
  initPromise = null;
}
