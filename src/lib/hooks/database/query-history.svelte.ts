import type { QueryResult, QueryHistoryItem, ConnectionLabel } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";

/**
 * Manages query history: adding entries, toggling favorites.
 * Note: loadQueryFromHistory is in UseDatabase as it orchestrates multiple services.
 */
export class QueryHistoryManager {
  constructor(
    private state: DatabaseState,
    private schedulePersistence: (connectionId: string | null) => void,
    private getConnectionLabels: (connectionId: string) => ConnectionLabel[],
    private getConnectionName: (connectionId: string) => string,
  ) {}

  /**
   * Add a query to history for the connection that executed it.
   */
  addToHistory(query: string, results: QueryResult, connectionId?: string) {
    const targetConnectionId = connectionId ?? this.state.activeConnectionId;
    if (!targetConnectionId) return;

    const queryHistory = this.state.queryHistoryByConnection[targetConnectionId] ?? [];
    const connectionLabelsSnapshot = this.getConnectionLabels(targetConnectionId).map((l) => ({
      ...l,
    }));
    const connectionNameSnapshot = this.getConnectionName(targetConnectionId);

    this.state.queryHistoryByConnection = {
      ...this.state.queryHistoryByConnection,
      [targetConnectionId]: [
        {
          id: `hist-${crypto.randomUUID()}`,
          query,
          timestamp: new Date(),
          executionTime: results.executionTime,
          rowCount: results.affectedRows ?? results.totalRows,
          connectionId: targetConnectionId,
          favorite: false,
          connectionLabelsSnapshot,
          connectionNameSnapshot,
        },
        ...queryHistory,
      ],
    };
    this.schedulePersistence(targetConnectionId);
  }

  /**
   * Toggle the favorite status of a history item.
   */
  toggleQueryFavorite(id: string) {
    if (!this.state.activeConnectionId) return;

    const connectionId = this.state.activeConnectionId;
    const queryHistory = this.state.queryHistoryByConnection[connectionId] ?? [];
    const item = queryHistory.find((h: QueryHistoryItem) => h.id === id);

    if (item) {
      const updatedHistory = queryHistory.map((h) =>
        h.id === id ? { ...h, favorite: !h.favorite } : h,
      );
      this.state.queryHistoryByConnection = {
        ...this.state.queryHistoryByConnection,
        [connectionId]: updatedHistory,
      };
      this.schedulePersistence(connectionId);
    }
  }
}
