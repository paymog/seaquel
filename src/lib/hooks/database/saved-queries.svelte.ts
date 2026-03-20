import type { SavedQuery, QueryTab, QueryParameter } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";

/**
 * Manages saved queries: save, delete.
 * Note: Saved queries are per-project.
 * Note: loadSavedQuery is in UseDatabase as it orchestrates with tabs and views.
 */
export class SavedQueryManager {
  constructor(
    private state: DatabaseState,
    private scheduleProjectPersistence: (projectId: string | null) => void,
  ) {}

  saveQuery(
    name: string,
    query: string,
    tabId?: string,
    parameters?: QueryParameter[],
  ): string | null {
    if (!this.state.activeProjectId) return null;

    const projectId = this.state.activeProjectId;

    // Check if this tab is already linked to a saved query
    let savedQueryId: string | undefined;
    if (tabId) {
      const tabs = this.state.queryTabsByProject[projectId] ?? [];
      const tab = tabs.find((t: QueryTab) => t.id === tabId);
      savedQueryId = tab?.savedQueryId;
    }

    if (savedQueryId) {
      // Update existing saved query with new object for proper reactivity
      const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
      const savedQuery = savedQueries.find((q) => q.id === savedQueryId);
      if (savedQuery) {
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

    // Link tab to saved query if tabId provided
    if (tabId) {
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

    // Remove savedQueryId from any tabs using this query
    const tabs = this.state.queryTabsByProject[projectId] ?? [];
    const updatedTabs = tabs.map((tab: QueryTab) =>
      tab.savedQueryId === id ? { ...tab, savedQueryId: undefined } : tab,
    );

    this.state.queryTabsByProject = {
      ...this.state.queryTabsByProject,
      [projectId]: updatedTabs,
    };
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
}
