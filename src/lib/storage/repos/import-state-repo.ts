import type { SqliteDatabase } from "../sqlite-types";

export const importStateRepo = {
  async load(
    db: SqliteDatabase,
    source: string,
  ): Promise<{ hasOfferedImport: boolean; lastCheckTimestamp: string | null } | null> {
    const rows = await db.query<{
      has_offered_import: number;
      last_check_timestamp: string | null;
    }>("SELECT has_offered_import, last_check_timestamp FROM import_state WHERE source = ?", [
      source,
    ]);
    if (rows.length === 0) return null;
    return {
      hasOfferedImport: rows[0].has_offered_import === 1,
      lastCheckTimestamp: rows[0].last_check_timestamp,
    };
  },

  async save(
    db: SqliteDatabase,
    source: string,
    hasOfferedImport: boolean,
    lastCheckTimestamp: string | null,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO import_state (source, has_offered_import, last_check_timestamp)
       VALUES (?, ?, ?)`,
      [source, hasOfferedImport ? 1 : 0, lastCheckTimestamp],
    );
  },
};
