import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col, nullable } from "../create-repo";
import type { PersistedProject } from "$lib/types";

const _projectRepo = createRepo<Omit<PersistedProject, "customLabels">>({
  table: "projects",
  id: "id",
  columns: {
    id: col("id"),
    name: col("name"),
    description: nullable("description"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
    gitRepoPath: nullable("git_repo_path"),
  },
});

export const projectsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedProject[]> {
    const rows = await _projectRepo.loadAll(db);
    const projects: PersistedProject[] = [];
    for (const row of rows) {
      const labels = await db.query<{
        id: string;
        name: string;
        is_predefined: number;
        color: string;
      }>("SELECT id, name, is_predefined, color FROM project_labels WHERE project_id = ?", [
        row.id,
      ]);

      projects.push({
        ...row,
        customLabels: labels.map((l) => ({
          id: l.id,
          name: l.name,
          isPredefined: l.is_predefined === 1,
          color: l.color,
        })),
      });
    }
    return projects;
  },

  async save(db: SqliteDatabase, project: PersistedProject): Promise<void> {
    const { customLabels, ...base } = project;
    await _projectRepo.save(db, base);

    // Replace labels
    await db.execute("DELETE FROM project_labels WHERE project_id = ?", [project.id]);
    for (const label of customLabels) {
      await db.execute(
        `INSERT INTO project_labels (id, project_id, name, is_predefined, color)
         VALUES (?, ?, ?, ?, ?)`,
        [label.id, project.id, label.name, label.isPredefined ? 1 : 0, label.color],
      );
    }
  },

  async saveAll(db: SqliteDatabase, projects: PersistedProject[]): Promise<void> {
    for (const project of projects) {
      await this.save(db, project);
    }
  },

  async remove(db: SqliteDatabase, projectId: string): Promise<void> {
    await _projectRepo.remove(db, projectId);
  },
};
