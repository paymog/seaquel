import type { SqliteDatabase } from "../sqlite-types";
import { safeJsonParse } from "../create-repo";
import type { PersistedSharedQueryRepo } from "$lib/types";
import { appStateRepo } from "./app-state-repo";

export const sharedReposRepo = {
  async loadAll(db: SqliteDatabase): Promise<{
    repos: PersistedSharedQueryRepo[];
    activeRepoId: string | null;
  }> {
    const rows = await db.query<{ id: string; data: string }>("SELECT id, data FROM shared_repos");
    const repos: PersistedSharedQueryRepo[] = rows
      .map((r) => safeJsonParse<PersistedSharedQueryRepo | null>(r.data, null))
      .filter((r): r is PersistedSharedQueryRepo => r !== null);
    const activeRepoId = await appStateRepo.get(db, "activeRepoId");
    return { repos, activeRepoId };
  },

  async saveAll(
    db: SqliteDatabase,
    repos: PersistedSharedQueryRepo[],
    activeRepoId: string | null,
  ): Promise<void> {
    const statements: Array<{ sql: string; params?: unknown[] }> = [
      { sql: "DELETE FROM shared_repos" },
    ];
    for (const repo of repos) {
      statements.push({
        sql: "INSERT INTO shared_repos (id, data) VALUES (?, ?)",
        params: [repo.id, JSON.stringify(repo)],
      });
    }
    await db.transaction(statements);
    await appStateRepo.set(db, "activeRepoId", activeRepoId);
  },
};
