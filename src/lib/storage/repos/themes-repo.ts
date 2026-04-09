import type { SqliteDatabase } from "../sqlite-types";
import { safeJsonParse } from "../create-repo";

export const themeRepo = {
  async loadPreferences(
    db: SqliteDatabase,
  ): Promise<{ lightThemeId: string; darkThemeId: string } | null> {
    const rows = await db.query<{ light_theme_id: string; dark_theme_id: string }>(
      "SELECT light_theme_id, dark_theme_id FROM theme_preferences WHERE id = 1",
    );
    if (rows.length === 0) return null;
    return { lightThemeId: rows[0].light_theme_id, darkThemeId: rows[0].dark_theme_id };
  },

  async savePreferences(
    db: SqliteDatabase,
    lightThemeId: string,
    darkThemeId: string,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO theme_preferences (id, light_theme_id, dark_theme_id)
       VALUES (1, ?, ?)`,
      [lightThemeId, darkThemeId],
    );
  },

  async loadUserThemes(db: SqliteDatabase): Promise<unknown[]> {
    const rows = await db.query<{ id: string; data: string }>("SELECT id, data FROM user_themes");
    return rows
      .map((r) => safeJsonParse<unknown>(r.data, null))
      .filter((t): t is NonNullable<typeof t> => t !== null);
  },

  async saveUserThemes(db: SqliteDatabase, themes: unknown[]): Promise<void> {
    const statements: Array<{ sql: string; params?: unknown[] }> = [
      { sql: "DELETE FROM user_themes" },
    ];
    for (const theme of themes) {
      const t = theme as { id: string };
      statements.push({
        sql: "INSERT INTO user_themes (id, data) VALUES (?, ?)",
        params: [t.id, JSON.stringify(theme)],
      });
    }
    await db.transaction(statements);
  },
};
