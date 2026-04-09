import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col } from "../create-repo";
import type { PersistedDashboardVersion } from "$lib/types";

const _dashboardVersionRepo = createRepo<PersistedDashboardVersion>({
  table: "dashboard_versions",
  id: "id",
  columns: {
    id: col("id"),
    dashboardId: col("dashboard_id"),
    version: col("version"),
    snapshot: col("snapshot"),
    createdAt: col("created_at"),
  },
});

export const dashboardVersionsRepo = {
  async loadByDashboard(
    db: SqliteDatabase,
    dashboardId: string,
  ): Promise<PersistedDashboardVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM dashboard_versions WHERE dashboard_id = ? ORDER BY version ASC",
      [dashboardId],
    );
    return rows.map((r) => _dashboardVersionRepo.mapRow(r));
  },

  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedDashboardVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT dv.* FROM dashboard_versions dv
       JOIN dashboards d ON d.id = dv.dashboard_id
       WHERE d.project_id = ?
       ORDER BY dv.dashboard_id, dv.version ASC`,
      [projectId],
    );
    return rows.map((r) => _dashboardVersionRepo.mapRow(r));
  },

  async insert(db: SqliteDatabase, version: PersistedDashboardVersion): Promise<void> {
    await db.execute(_dashboardVersionRepo.insertSql, _dashboardVersionRepo.toParams(version));
  },

  async pruneOldVersions(
    db: SqliteDatabase,
    dashboardId: string,
    keepCount: number,
  ): Promise<void> {
    await db.execute(
      `DELETE FROM dashboard_versions
       WHERE dashboard_id = ?
         AND version <= (
           SELECT version FROM dashboard_versions
           WHERE dashboard_id = ?
           ORDER BY version DESC
           LIMIT 1 OFFSET ?
         )`,
      [dashboardId, dashboardId, keepCount],
    );
  },
};
