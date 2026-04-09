import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col } from "../create-repo";
import type { PersistedQueryVersion } from "$lib/types";

const _queryVersionRepo = createRepo<PersistedQueryVersion>({
  table: "query_versions",
  id: "id",
  columns: {
    id: col("id"),
    queryId: col("saved_query_id"),
    version: col("version"),
    snapshot: col("snapshot"),
    diff: col("diff"),
    createdAt: col("created_at"),
  },
});

export const queryVersionsRepo = {
  async loadByQuery(db: SqliteDatabase, queryId: string): Promise<PersistedQueryVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM query_versions WHERE saved_query_id = ? ORDER BY version ASC",
      [queryId],
    );
    return rows.map((r) => _queryVersionRepo.mapRow(r));
  },

  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedQueryVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT qv.* FROM query_versions qv
       JOIN saved_queries sq ON sq.id = qv.saved_query_id
       WHERE sq.project_id = ?
       ORDER BY qv.saved_query_id, qv.version ASC`,
      [projectId],
    );
    return rows.map((r) => _queryVersionRepo.mapRow(r));
  },

  async insert(db: SqliteDatabase, version: PersistedQueryVersion): Promise<void> {
    await db.execute(_queryVersionRepo.insertSql, _queryVersionRepo.toParams(version));
  },

  async pruneOldVersions(db: SqliteDatabase, queryId: string, keepCount: number): Promise<void> {
    // Resolve all versions BEFORE pruning so we can promote the oldest survivor to a keyframe
    const allVersions = await this.loadByQuery(db, queryId);
    if (allVersions.length <= keepCount) return;

    // Find the version threshold — versions at or below this will be deleted
    const sorted = [...allVersions].sort((a, b) => b.version - a.version);
    const cutoffVersion = sorted[keepCount - 1]?.version;
    if (cutoffVersion === undefined) return;

    // Resolve texts before deleting, so we can recover the oldest survivor's full text
    const { resolveVersions } = await import("$lib/utils/query-versions");
    const resolved = resolveVersions(
      allVersions.map((v) => ({ ...v, createdAt: new Date(v.createdAt) })),
    );

    // Find the oldest survivor and its resolved text
    const oldestSurvivor = sorted[keepCount - 1];
    const resolvedSurvivor = resolved.find((r) => r.id === oldestSurvivor.id);

    await db.execute(
      `DELETE FROM query_versions
       WHERE saved_query_id = ?
         AND version < ?`,
      [queryId, cutoffVersion],
    );

    // Promote the oldest surviving version to a keyframe if it's a delta
    if (oldestSurvivor.snapshot === null && resolvedSurvivor) {
      await db.execute(`UPDATE query_versions SET snapshot = ?, diff = NULL WHERE id = ?`, [
        resolvedSurvivor.query,
        oldestSurvivor.id,
      ]);
    }
  },
};
