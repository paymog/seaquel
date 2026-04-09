import type { SqliteDatabase } from "../sqlite-types";
import { safeJsonParse } from "../create-repo";

export const onboardingRepo = {
  async load(db: SqliteDatabase): Promise<unknown> {
    const rows = await db.query<{ data: string }>("SELECT data FROM onboarding_state WHERE id = 1");
    if (rows.length === 0) return null;
    return safeJsonParse(rows[0].data, null);
  },

  async save(db: SqliteDatabase, data: unknown): Promise<void> {
    await db.execute("INSERT OR REPLACE INTO onboarding_state (id, data) VALUES (1, ?)", [
      JSON.stringify(data),
    ]);
  },
};
