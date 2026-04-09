import type { SqliteDatabase } from "../sqlite-types";

export const appStateRepo = {
  async get(db: SqliteDatabase, key: string): Promise<string | null> {
    const rows = await db.query<{ value: string | null }>(
      "SELECT value FROM app_state WHERE key = ?",
      [key],
    );
    if (rows.length === 0) return null;
    return rows[0].value;
  },

  async set(db: SqliteDatabase, key: string, value: string | null): Promise<void> {
    await db.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [key, value]);
  },
};
