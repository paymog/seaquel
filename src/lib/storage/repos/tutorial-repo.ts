import type { SqliteDatabase } from "../sqlite-types";

export const tutorialRepo = {
  async loadAll(
    db: SqliteDatabase,
  ): Promise<Array<{ lessonId: string; challengeId: string; state: string | null }>> {
    return db.query<{ lessonId: string; challengeId: string; state: string | null }>(
      "SELECT lesson_id as lessonId, challenge_id as challengeId, state FROM tutorial_progress",
    );
  },

  async save(
    db: SqliteDatabase,
    lessonId: string,
    challengeId: string,
    state: string | null,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO tutorial_progress (lesson_id, challenge_id, state)
       VALUES (?, ?, ?)`,
      [lessonId, challengeId, state],
    );
  },

  async removeLesson(db: SqliteDatabase, lessonId: string): Promise<void> {
    await db.execute("DELETE FROM tutorial_progress WHERE lesson_id = ?", [lessonId]);
  },

  async removeAll(db: SqliteDatabase): Promise<void> {
    await db.execute("DELETE FROM tutorial_progress");
  },
};
