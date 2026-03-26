import type { SavedQuery, QueryTab, QueryParameter, QueryVersion } from "$lib/types";
import type { ResolvedQueryVersion } from "$lib/types";
import { createVersionEntry, resolveVersions } from "$lib/utils/query-versions";
import type { DatabaseState } from "./state.svelte.js";
import type { PersistenceManager } from "./persistence-manager.svelte.js";

/**
 * Manages saved queries: save, delete.
 * Note: Saved queries are per-project.
 * Note: loadSavedQuery is in UseDatabase as it orchestrates with tabs and views.
 */
export class SavedQueryManager {
  private removeTab: ((id: string) => void) | null = null;

  constructor(
    private state: DatabaseState,
    private scheduleProjectPersistence: (projectId: string | null) => void,
    private persistence: PersistenceManager,
  ) {}

  setRemoveTab(fn: (id: string) => void) {
    this.removeTab = fn;
  }

  saveQuery(
    name: string,
    query: string,
    tabId?: string,
    parameters?: QueryParameter[],
    forceNew?: boolean,
  ): string | null {
    if (!this.state.activeProjectId) return null;

    const projectId = this.state.activeProjectId;

    // Check if this tab is already linked to a saved query
    let savedQueryId: string | undefined;
    if (tabId && !forceNew) {
      const tabs = this.state.queryTabsByProject[projectId] ?? [];
      const tab = tabs.find((t: QueryTab) => t.id === tabId);
      savedQueryId = tab?.savedQueryId;
    }

    if (savedQueryId) {
      // Update existing saved query with new object for proper reactivity
      const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
      const savedQuery = savedQueries.find((q) => q.id === savedQueryId);
      if (savedQuery) {
        // Create a version for the previous state before updating
        const versions = this.getVersionsForQuery(savedQueryId!);
        const nextVersion =
          versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;

        // For delta versions, we need the previous version's resolved text
        let previousVersionQuery: string | undefined;
        if (nextVersion > 1) {
          const resolved = resolveVersions(versions);
          previousVersionQuery =
            resolved.length > 0 ? resolved[resolved.length - 1].query : savedQuery.query;
        }

        const newVersion = createVersionEntry(
          savedQueryId!,
          nextVersion,
          savedQuery.query,
          previousVersionQuery,
        );

        // Add to state
        const projectVersions = this.state.queryVersionsByProject[projectId] ?? [];
        this.state.queryVersionsByProject = {
          ...this.state.queryVersionsByProject,
          [projectId]: [...projectVersions, newVersion],
        };

        // Persist immediately
        this.persistence
          .persistQueryVersion({
            id: newVersion.id,
            savedQueryId: newVersion.savedQueryId,
            version: newVersion.version,
            snapshot: newVersion.snapshot,
            diff: newVersion.diff,
            createdAt: newVersion.createdAt.toISOString(),
          })
          .catch((err) => console.error("[saved-queries] Failed to persist query version:", err));

        // Prune old versions if over limit
        this.pruneIfNeeded(savedQueryId!, projectId).catch((err) =>
          console.error("[saved-queries] Failed to prune query versions:", err),
        );

        // Then update the saved query as before
        const updatedSavedQueries = savedQueries.map((q) =>
          q.id === savedQueryId ? { ...q, name, query, parameters, updatedAt: new Date() } : q,
        );
        this.state.savedQueriesByProject = {
          ...this.state.savedQueriesByProject,
          [projectId]: updatedSavedQueries,
        };

        // Also update tab name if it differs
        if (tabId) {
          const tabs = this.state.queryTabsByProject[projectId] ?? [];
          const tab = tabs.find((t: QueryTab) => t.id === tabId);
          if (tab && tab.name !== name) {
            const updatedTabs = tabs.map((t: QueryTab) => (t.id === tabId ? { ...t, name } : t));
            this.state.queryTabsByProject = {
              ...this.state.queryTabsByProject,
              [projectId]: updatedTabs,
            };
          }
        }

        this.scheduleProjectPersistence(projectId);
        return savedQueryId;
      }
    }

    // Create new saved query
    const newSavedQuery: SavedQuery = {
      id: `saved-${crypto.randomUUID()}`,
      name,
      query,
      projectId,
      createdAt: new Date(),
      updatedAt: new Date(),
      parameters,
    };

    const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
    this.state.savedQueriesByProject = {
      ...this.state.savedQueriesByProject,
      [projectId]: [...savedQueries, newSavedQuery],
    };

    // Link tab to saved query if tabId provided (skip for forceNew — caller handles it)
    if (tabId && !forceNew) {
      const tabs = this.state.queryTabsByProject[projectId] ?? [];
      const updatedTabs = tabs.map((t: QueryTab) =>
        t.id === tabId ? { ...t, savedQueryId: newSavedQuery.id, name } : t,
      );
      this.state.queryTabsByProject = {
        ...this.state.queryTabsByProject,
        [projectId]: updatedTabs,
      };
    }

    this.scheduleProjectPersistence(projectId);
    return newSavedQuery.id;
  }

  deleteSavedQuery(id: string) {
    if (!this.state.activeProjectId) return;

    const projectId = this.state.activeProjectId;
    const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
    const filtered = savedQueries.filter((q) => q.id !== id);

    this.state.savedQueriesByProject = {
      ...this.state.savedQueriesByProject,
      [projectId]: filtered,
    };

    // Remove versions from state (SQLite CASCADE handles persistence)
    const projectVersions = this.state.queryVersionsByProject[projectId] ?? [];
    const filteredVersions = projectVersions.filter((v) => v.savedQueryId !== id);
    this.state.queryVersionsByProject = {
      ...this.state.queryVersionsByProject,
      [projectId]: filteredVersions,
    };

    // Close any tabs linked to this query
    const tabs = this.state.queryTabsByProject[projectId] ?? [];
    for (const tab of tabs) {
      if (tab.savedQueryId === id && this.removeTab) {
        this.removeTab(tab.id);
      }
    }

    this.scheduleProjectPersistence(projectId);
  }

  toggleSavedQueryStarred(id: string) {
    if (!this.state.activeProjectId) return;

    const projectId = this.state.activeProjectId;
    const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
    const updatedQueries = savedQueries.map((q) =>
      q.id === id ? { ...q, starred: !q.starred } : q,
    );

    this.state.savedQueriesByProject = {
      ...this.state.savedQueriesByProject,
      [projectId]: updatedQueries,
    };
    this.scheduleProjectPersistence(projectId);
  }

  toggleSharedQueryStarred(id: string) {
    const newSet = new Set(this.state.starredSharedQueryIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    this.state.starredSharedQueryIds = newSet;
    this.scheduleProjectPersistence(this.state.activeProjectId);
  }

  getVersionsForQuery(savedQueryId: string): QueryVersion[] {
    if (!this.state.activeProjectId) return [];
    const versions = this.state.queryVersionsByProject[this.state.activeProjectId] ?? [];
    return versions.filter((v) => v.savedQueryId === savedQueryId);
  }

  getResolvedVersionsForQuery(savedQueryId: string): ResolvedQueryVersion[] {
    return resolveVersions(this.getVersionsForQuery(savedQueryId));
  }

  private async pruneIfNeeded(savedQueryId: string, projectId: string): Promise<void> {
    const { getDatabase } = await import("$lib/storage/db");
    const { appStateRepo } = await import("$lib/storage/repository");
    const db = await getDatabase();
    const limitStr = await appStateRepo.get(db, "query_version_limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    await this.persistence.pruneQueryVersions(savedQueryId, limit);

    // Also update state to reflect pruning
    const versions = this.state.queryVersionsByProject[projectId] ?? [];
    const queryVersions = versions.filter((v) => v.savedQueryId === savedQueryId);
    if (queryVersions.length > limit) {
      const sorted = [...queryVersions].sort((a, b) => b.version - a.version);
      const keepIds = new Set(sorted.slice(0, limit).map((v) => v.id));
      const filtered = versions.filter((v) => v.savedQueryId !== savedQueryId || keepIds.has(v.id));
      this.state.queryVersionsByProject = {
        ...this.state.queryVersionsByProject,
        [projectId]: filtered,
      };
    }
  }
}
