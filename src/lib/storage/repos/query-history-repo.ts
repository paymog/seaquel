import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col, bool, json } from "../create-repo";
import type { PersistedQueryHistoryItem } from "$lib/types";

const _historyRepo = createRepo<PersistedQueryHistoryItem>({
  table: "query_history",
  id: "id",
  columns: {
    id: col("id"),
    query: col("query"),
    timestamp: col("timestamp"),
    executionTime: col("execution_time"),
    rowCount: col("row_count"),
    connectionId: col("connection_id"),
    favorite: bool("favorite"),
    connectionLabelsSnapshot: json("connection_labels_snapshot", []),
    connectionNameSnapshot: col("connection_name_snapshot"),
  },
});

export const queryHistoryRepo = {
  async loadByConnection(
    db: SqliteDatabase,
    connectionId: string,
  ): Promise<PersistedQueryHistoryItem[]> {
    const rows = await db.query(
      `SELECT * FROM query_history WHERE connection_id = ? ORDER BY timestamp DESC`,
      [connectionId],
    );
    return rows.map((r) => _historyRepo.mapRow(r as Record<string, unknown>));
  },

  async replaceAll(
    db: SqliteDatabase,
    connectionId: string,
    items: PersistedQueryHistoryItem[],
  ): Promise<void> {
    const statements: Array<{ sql: string; params?: unknown[] }> = [
      { sql: "DELETE FROM query_history WHERE connection_id = ?", params: [connectionId] },
    ];
    for (const h of items) {
      statements.push({ sql: _historyRepo.insertSql, params: _historyRepo.toParams(h) });
    }
    await db.transaction(statements);
  },

  async removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    await _historyRepo.removeBy(db, "connection_id = ?", [connectionId]);
  },
};
