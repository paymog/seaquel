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
 * Handles hydration of saved queries and query history.
 *
 * Note: Tab restoration is now handled by ProjectManager since tabs are per-project.
 */
export class StateRestorationManager {
  constructor(
    private state: DatabaseState,
    private persistence: PersistenceManager,
  ) {}

  /**
   * Initialize connection data maps for a new connection.
   * Sets up query history, saved queries, and schema storage.
   */
  initializeConnectionMaps(connectionId: string): void {
    // Query history and saved queries remain per-connection
    this.state.queryHistoryByConnection = {
      ...this.state.queryHistoryByConnection,
      [connectionId]: [],
    };
    this.state.savedQueriesByConnection = {
      ...this.state.savedQueriesByConnection,
      [connectionId]: [],
    };
    // Schema storage is per-connection
    this.state.schemas = {
      ...this.state.schemas,
      [connectionId]: [],
    };
    // Dashboards are per-connection
    this.state.dashboardsByConnection = {
      ...this.state.dashboardsByConnection,
      [connectionId]: [],
    };
  }

  /**
   * Clean up connection data when removing a connection.
   */
  cleanupConnectionMaps(connectionId: string): void {
    const { [connectionId]: _1, ...restQueryHistory } = this.state.queryHistoryByConnection;
    this.state.queryHistoryByConnection = restQueryHistory;

    const { [connectionId]: _2, ...restSavedQueries } = this.state.savedQueriesByConnection;
    this.state.savedQueriesByConnection = restSavedQueries;

    const { [connectionId]: _3, ...restSchemas } = this.state.schemas;
    this.state.schemas = restSchemas;

    const { [connectionId]: _4, ...restDashboards } = this.state.dashboardsByConnection;
    this.state.dashboardsByConnection = restDashboards;
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
    if (!(connectionId in this.state.savedQueriesByConnection)) {
      this.state.savedQueriesByConnection = {
        ...this.state.savedQueriesByConnection,
        [connectionId]: [],
      };
    }
  }

  /**
   * Restore saved queries from persisted data.
   */
  restoreSavedQueries(connectionId: string, data: PersistedSavedQuery[]): void {
    const savedQueries: SavedQuery[] = data.map((q) => ({
      id: q.id,
      name: q.name,
      query: q.query,
      connectionId: q.connectionId,
      createdAt: new Date(q.createdAt),
      updatedAt: new Date(q.updatedAt),
      parameters: q.parameters,
    }));
    this.state.savedQueriesByConnection = {
      ...this.state.savedQueriesByConnection,
      [connectionId]: savedQueries,
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
   * Restore dashboards from persisted data.
   */
  restoreDashboards(connectionId: string, data: PersistedDashboard[]): void {
    const dashboards: Dashboard[] = data.map((r) => ({
      id: r.id,
      name: r.name,
      connectionId: r.connectionId,
      widgets: JSON.parse(r.widgets),
      viewport: JSON.parse(r.viewport),
      dateFilter: r.dateFilter ? JSON.parse(r.dateFilter) : null,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
    this.state.dashboardsByConnection = {
      ...this.state.dashboardsByConnection,
      [connectionId]: dashboards,
    };
  }

  /**
   * Load connection data (saved queries, history, and dashboards) from persistence.
   */
  async loadConnectionData(connectionId: string): Promise<void> {
    const data = await this.persistence.loadConnectionData(connectionId);

    if (data.savedQueries.length > 0) {
      this.restoreSavedQueries(connectionId, data.savedQueries);
    }

    if (data.queryHistory.length > 0) {
      this.restoreQueryHistory(connectionId, data.queryHistory);
    }

    if (data.dashboards.length > 0) {
      this.restoreDashboards(connectionId, data.dashboards);
    }
  }
}
