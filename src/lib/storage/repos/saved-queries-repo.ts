import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col, nullable, bool, json } from "../create-repo";
import type { PersistedSavedQuery } from "$lib/types";

const _savedQueryRepo = createRepo<PersistedSavedQuery>({
  table: "saved_queries",
  id: "id",
  columns: {
    id: col("id"),
    projectId: col("project_id"),
    name: col("name"),
    query: col("query"),
    parameters: json("parameters", undefined),
    starred: bool("starred"),
    shared: bool("shared"),
    description: nullable("description"),
    databaseType: nullable("database_type"),
    tags: json("tags", undefined),
    folder: nullable("folder"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
  },
});

export const savedQueriesRepo = {
  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedSavedQuery[]> {
    return _savedQueryRepo.loadBy(db, "project_id = ?", [projectId]);
  },

  async saveAll(
    db: SqliteDatabase,
    projectId: string,
    queries: PersistedSavedQuery[],
  ): Promise<void> {
    // Use upsert instead of delete+reinsert to preserve CASCADE children (query_versions)
    const currentIds = queries.map((q) => q.id);
    const statements: Array<{ sql: string; params?: unknown[] }> = [];

    if (currentIds.length > 0) {
      const placeholders = currentIds.map(() => "?").join(",");
      statements.push({
        sql: `DELETE FROM saved_queries WHERE project_id = ? AND id NOT IN (${placeholders})`,
        params: [projectId, ...currentIds],
      });
    } else {
      statements.push({
        sql: "DELETE FROM saved_queries WHERE project_id = ?",
        params: [projectId],
      });
    }
    for (const q of queries) {
      statements.push({ sql: _savedQueryRepo.upsertSql, params: _savedQueryRepo.toParams(q) });
    }
    await db.transaction(statements);
  },

  async removeByProject(db: SqliteDatabase, projectId: string): Promise<void> {
    return _savedQueryRepo.removeBy(db, "project_id = ?", [projectId]);
  },
};
