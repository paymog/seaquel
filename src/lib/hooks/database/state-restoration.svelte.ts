import type {
  SavedQuery,
  QueryHistoryItem,
  Dashboard,
  PersistedSavedQuery,
  PersistedQueryHistoryItem,
} from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { PersistenceManager } from "./persistence-manager.svelte.js";
import type { PersistedDashboard } from "$lib/storage/repository";

/**
 * Manages restoration of persisted connection data when loading the app.
 * Handles hydration of query history (per-connection) and
 * saved queries / dashboards (per-project).
 *
 * Note: Tab restoration is handled by ProjectManager since tabs are per-project.
 */
export class StateRestorationManager {
  constructor(
    private state: DatabaseState,
    private persistence: PersistenceManager,
  ) {}

  /**
   * Initialize connection data maps for a new connection.
   * Sets up query history and schema storage.
   */
  initializeConnectionMaps(connectionId: string): void {
    // Query history remains per-connection
    this.state.queryHistoryByConnection = {
      ...this.state.queryHistoryByConnection,
      [connectionId]: [],
    };
    // Schema storage is per-connection
    this.state.schemas = {
      ...this.state.schemas,
      [connectionId]: [],
    };
  }

  /**
   * Clean up connection data when removing a connection.
   */
  cleanupConnectionMaps(connectionId: string): void {
    const { [connectionId]: _1, ...restQueryHistory } = this.state.queryHistoryByConnection;
    this.state.queryHistoryByConnection = restQueryHistory;

    const { [connectionId]: _3, ...restSchemas } = this.state.schemas;
    this.state.schemas = restSchemas;
  }

  /**
   * Ensure connection data maps exist (used during reconnect).
   */
  ensureConnectionMapsExist(connectionId: string): void {
    if (!(connectionId in this.state.queryHistoryByConnection)) {
      this.state.queryHistoryByConnection = {
        ...this.state.queryHistoryByConnection,
        [connectionId]: [],
      };
    }
  }

  /**
   * Restore saved queries from persisted data (per-project).
   */
  restoreSavedQueries(projectId: string, data: PersistedSavedQuery[]): void {
    const savedQueries: SavedQuery[] = data.map((q) => ({
      id: q.id,
      name: q.name,
      query: q.query,
      projectId: q.projectId,
      createdAt: new Date(q.createdAt),
      updatedAt: new Date(q.updatedAt),
      parameters: q.parameters,
    }));
    this.state.savedQueriesByProject = {
      ...this.state.savedQueriesByProject,
      [projectId]: savedQueries,
    };
  }

  /**
   * Restore query history from persisted data.
   */
  restoreQueryHistory(connectionId: string, data: PersistedQueryHistoryItem[]): void {
    const history: QueryHistoryItem[] = data.map((h) => ({
      id: h.id,
      query: h.query,
      timestamp: new Date(h.timestamp),
      executionTime: h.executionTime,
      rowCount: h.rowCount,
      connectionId: h.connectionId,
      favorite: h.favorite,
      connectionLabelsSnapshot: h.connectionLabelsSnapshot || [],
      connectionNameSnapshot: h.connectionNameSnapshot || "",
    }));
    this.state.queryHistoryByConnection = {
      ...this.state.queryHistoryByConnection,
      [connectionId]: history,
    };
  }

  /**
   * Restore dashboards from persisted data (per-project).
   */
  restoreDashboards(projectId: string, data: PersistedDashboard[]): void {
    const dashboards: Dashboard[] = data.map((r) => ({
      id: r.id,
      name: r.name,
      projectId: r.projectId,
      widgets: JSON.parse(r.widgets),
      viewport: JSON.parse(r.viewport),
      dateFilter: r.dateFilter ? JSON.parse(r.dateFilter) : null,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
    this.state.dashboardsByProject = {
      ...this.state.dashboardsByProject,
      [projectId]: dashboards,
    };
  }

  /**
   * Load connection data (query history only) from persistence.
   */
  async loadConnectionData(connectionId: string): Promise<void> {
    const data = await this.persistence.loadConnectionData(connectionId);

    if (data.queryHistory.length > 0) {
      this.restoreQueryHistory(connectionId, data.queryHistory);
    }
  }

  /**
   * Load project-specific data (saved queries and dashboards) from persistence.
   */
  async loadProjectData(projectId: string): Promise<void> {
    const savedQueries = await this.persistence.loadProjectSavedQueries(projectId);
    if (savedQueries.length > 0) {
      this.restoreSavedQueries(projectId, savedQueries);
    }

    const dashboards = await this.persistence.loadProjectDashboards(projectId);
    if (dashboards.length > 0) {
      this.restoreDashboards(projectId, dashboards);
    }
  }
}
