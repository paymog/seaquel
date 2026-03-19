import { withErrorHandling } from "$lib/errors";
import type {
  PersistedQueryTab,
  PersistedSchemaTab,
  PersistedExplainTab,
  PersistedErdTab,
  PersistedStatisticsTab,
  PersistedCanvasTab,
  PersistedStarterTab,
  PersistedDashboardTab,
  PersistedSavedQuery,
  PersistedQueryHistoryItem,
  DatabaseConnection,
  PersistedProject,
  PersistedProjectState,
  PersistedSharedQueryRepo,
} from "$lib/types";
import { serializeRepo } from "$lib/types";
import type { SavedCanvas } from "$lib/types/canvas";
import type { DatabaseState } from "./state.svelte.js";
import type { PersistedConnection } from "./types.js";
import type { ConnectionOverride } from "$lib/types";
import {
  getDatabase,
  projectsRepo,
  appStateRepo,
  connectionsRepo,
  projectStateRepo,
  savedQueriesRepo,
  queryHistoryRepo,
  sharedReposRepo,
  dashboardsRepo,
  connectionOverridesRepo,
} from "$lib/storage";
import { getKeyringService } from "$lib/services/keyring";

/**
 * Manages persistence of projects, connections, and their state to SQLite.
 * Handles serialization, debounced saving, and state loading.
 *
 * Storage: single seaquel.db SQLite database with tables for each domain.
 */
export class PersistenceManager {
  private persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  private sharedReposTimer: ReturnType<typeof setTimeout> | null = null;
  readonly PERSISTENCE_DEBOUNCE_MS = 500;
  readonly MAX_HISTORY_ITEMS = 500;

  constructor(private state: DatabaseState) {}

  /**
   * Cancel any pending debounced persistence timer.
   */
  cancelPendingPersistence(): void {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
  }

  /**
   * Schedule persistence with debouncing to avoid excessive I/O.
   */
  scheduleProject(projectId: string | null): void {
    if (!projectId) return;

    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
    }
    this.persistenceTimer = setTimeout(() => {
      void this.persistProjectState(projectId);
      this.persistenceTimer = null;
    }, this.PERSISTENCE_DEBOUNCE_MS);
  }

  /**
   * Schedule connection data persistence (history, saved queries).
   */
  scheduleConnectionData(connectionId: string | null): void {
    if (!connectionId) return;

    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
    }
    this.persistenceTimer = setTimeout(() => {
      void this.persistConnectionData(connectionId);
      this.persistenceTimer = null;
    }, this.PERSISTENCE_DEBOUNCE_MS);
  }

  /**
   * Schedule shared repos persistence.
   */
  scheduleSharedRepos(): void {
    if (this.sharedReposTimer) {
      clearTimeout(this.sharedReposTimer);
    }
    this.sharedReposTimer = setTimeout(() => {
      void this.persistSharedRepos();
      this.sharedReposTimer = null;
    }, this.PERSISTENCE_DEBOUNCE_MS);
  }

  /**
   * Immediately flush any pending persistence operations.
   */
  async flush(): Promise<void> {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    if (this.sharedReposTimer) {
      clearTimeout(this.sharedReposTimer);
      this.sharedReposTimer = null;
    }
    // Persist all projects that have data
    for (const projectId of Object.keys(this.state.queryTabsByProject)) {
      await this.persistProjectState(projectId);
    }
    // Persist all connection data
    for (const connectionId of Object.keys(this.state.queryHistoryByConnection)) {
      await this.persistConnectionData(connectionId);
    }
    // Persist shared repos
    if (this.state.sharedRepos.length > 0) {
      await this.persistSharedRepos();
    }
  }

  /**
   * Clean up resources. Should be called when component unmounts.
   */
  async cleanup(): Promise<void> {
    await this.flush();
  }

  // === SERIALIZATION METHODS ===

  serializeQueryTabs(projectId: string): PersistedQueryTab[] {
    const tabs = this.state.queryTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      query: tab.query,
      savedQueryId: tab.savedQueryId,
    }));
  }

  serializeSchemaTabs(projectId: string): PersistedSchemaTab[] {
    const tabs = this.state.schemaTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      tableName: tab.table.name,
      schemaName: tab.table.schema,
    }));
  }

  serializeExplainTabs(projectId: string): PersistedExplainTab[] {
    const tabs = this.state.explainTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      sourceQuery: tab.sourceQuery,
    }));
  }

  serializeErdTabs(projectId: string): PersistedErdTab[] {
    const tabs = this.state.erdTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      connectionId: tab.connectionId,
    }));
  }

  serializeStatisticsTabs(projectId: string): PersistedStatisticsTab[] {
    const tabs = this.state.statisticsTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      connectionId: tab.connectionId,
    }));
  }

  serializeCanvasTabs(projectId: string): PersistedCanvasTab[] {
    const tabs = this.state.canvasTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      connectionId: tab.connectionId,
    }));
  }

  serializeStarterTabs(projectId: string): PersistedStarterTab[] {
    const tabs = this.state.starterTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      type: tab.type,
      name: tab.name,
      closable: tab.closable,
    }));
  }

  serializeConnectionTabs(_projectId: string): [] {
    // Connection tabs are transient and not persisted (they contain passwords)
    return [];
  }

  serializeDashboardTabs(projectId: string): PersistedDashboardTab[] {
    const tabs = this.state.dashboardTabsByProject[projectId] ?? [];
    return tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      connectionId: tab.connectionId,
      dashboardId: tab.dashboardId,
    }));
  }

  serializeSavedCanvases(projectId: string): SavedCanvas[] {
    return this.state.savedCanvasesByProject[projectId] ?? [];
  }

  serializeSavedQueries(connectionId: string): PersistedSavedQuery[] {
    const queries = this.state.savedQueriesByConnection[connectionId] ?? [];
    return queries.map((q) => ({
      id: q.id,
      name: q.name,
      query: q.query,
      connectionId: q.connectionId,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      parameters: q.parameters,
    }));
  }

  serializeQueryHistory(connectionId: string): PersistedQueryHistoryItem[] {
    const history = this.state.queryHistoryByConnection[connectionId] ?? [];
    return history.slice(0, this.MAX_HISTORY_ITEMS).map((h) => ({
      id: h.id,
      query: h.query,
      timestamp: h.timestamp.toISOString(),
      executionTime: h.executionTime,
      rowCount: h.rowCount,
      connectionId: h.connectionId,
      favorite: h.favorite,
      connectionLabelsSnapshot: h.connectionLabelsSnapshot,
      connectionNameSnapshot: h.connectionNameSnapshot,
    }));
  }

  // === PROJECT PERSISTENCE ===

  async persistProjects(): Promise<void> {
    try {
      const db = await getDatabase();

      const projects: PersistedProject[] = this.state.projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        customLabels: p.customLabels,
        gitRepoPath: p.gitRepoPath,
      }));

      await projectsRepo.saveAll(db, projects);
    } catch (error) {
      console.error("Failed to persist projects:", error);
    }
  }

  async loadProjects(): Promise<PersistedProject[]> {
    try {
      const db = await getDatabase();
      return await projectsRepo.loadAll(db);
    } catch (error) {
      console.error("Failed to load projects:", error);
      return [];
    }
  }

  // === APP STATE PERSISTENCE ===

  async persistAppState(): Promise<void> {
    try {
      const db = await getDatabase();
      await appStateRepo.set(db, "lastActiveProjectId", this.state.activeProjectId);
    } catch (error) {
      console.error("Failed to persist app state:", error);
    }
  }

  async getLastActiveProjectId(): Promise<string | null> {
    try {
      const db = await getDatabase();
      return await appStateRepo.get(db, "lastActiveProjectId");
    } catch (error) {
      console.error("Failed to load last active project:", error);
      return null;
    }
  }

  // === PROJECT STATE PERSISTENCE (tabs, active IDs) ===

  async persistProjectState(projectId: string): Promise<void> {
    try {
      const db = await getDatabase();

      const state: PersistedProjectState = {
        projectId,
        queryTabs: this.serializeQueryTabs(projectId),
        schemaTabs: this.serializeSchemaTabs(projectId),
        explainTabs: this.serializeExplainTabs(projectId),
        erdTabs: this.serializeErdTabs(projectId),
        statisticsTabs: this.serializeStatisticsTabs(projectId),
        canvasTabs: this.serializeCanvasTabs(projectId),
        tabOrder: this.state.tabOrderByProject[projectId] ?? [],
        activeQueryTabId: this.state.activeQueryTabIdByProject[projectId] ?? null,
        activeSchemaTabId: this.state.activeSchemaTabIdByProject[projectId] ?? null,
        activeExplainTabId: this.state.activeExplainTabIdByProject[projectId] ?? null,
        activeErdTabId: this.state.activeErdTabIdByProject[projectId] ?? null,
        activeStatisticsTabId: this.state.activeStatisticsTabIdByProject[projectId] ?? null,
        activeCanvasTabId: this.state.activeCanvasTabIdByProject[projectId] ?? null,
        activeView: this.state.activeView,
        activeConnectionId: this.state.activeConnectionIdByProject[projectId] ?? null,
        starterTabs: this.serializeStarterTabs(projectId),
        activeStarterTabId: this.state.activeStarterTabIdByProject[projectId] ?? null,
        savedCanvases: this.serializeSavedCanvases(projectId),
        connectionTabs: [],
        activeConnectionTabId: null,
        dashboardTabs: this.serializeDashboardTabs(projectId),
        activeDashboardTabId: this.state.activeDashboardTabIdByProject[projectId] ?? null,
      };

      await projectStateRepo.save(db, state);
    } catch (error) {
      console.error(`Failed to persist state for project ${projectId}:`, error);
    }
  }

  async loadProjectState(projectId: string): Promise<PersistedProjectState | null> {
    try {
      const db = await getDatabase();
      return await projectStateRepo.load(db, projectId);
    } catch (error) {
      console.error(`Failed to load persisted state for project ${projectId}:`, error);
      return null;
    }
  }

  async removeProjectState(projectId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await projectStateRepo.remove(db, projectId);
    } catch (error) {
      console.error(`Failed to remove persisted state for project ${projectId}:`, error);
    }
  }

  async removeProject(projectId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await projectsRepo.remove(db, projectId);
    } catch (error) {
      console.error(`Failed to remove project ${projectId}:`, error);
    }
  }

  // === CONNECTION DATA PERSISTENCE (history, saved queries) ===

  async persistConnectionData(connectionId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await savedQueriesRepo.saveAll(db, connectionId, this.serializeSavedQueries(connectionId));
      await queryHistoryRepo.replaceAll(db, connectionId, this.serializeQueryHistory(connectionId));
    } catch (error) {
      console.error(`Failed to persist data for connection ${connectionId}:`, error);
    }
  }

  async loadConnectionData(connectionId: string): Promise<{
    savedQueries: PersistedSavedQuery[];
    queryHistory: PersistedQueryHistoryItem[];
    dashboards: import("$lib/storage/repository").PersistedDashboard[];
  }> {
    try {
      const db = await getDatabase();
      let dashboards: import("$lib/storage/repository").PersistedDashboard[] = [];
      try {
        dashboards = await dashboardsRepo.loadByConnection(db, connectionId);
      } catch {
        // dashboards table may not exist yet (pre-v3 migration)
      }
      return {
        savedQueries: await savedQueriesRepo.loadByConnection(db, connectionId),
        queryHistory: await queryHistoryRepo.loadByConnection(db, connectionId),
        dashboards,
      };
    } catch (error) {
      console.error(`Failed to load data for connection ${connectionId}:`, error);
      return { savedQueries: [], queryHistory: [], dashboards: [] };
    }
  }

  async removeConnectionData(connectionId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await savedQueriesRepo.removeByConnection(db, connectionId);
      await queryHistoryRepo.removeByConnection(db, connectionId);
      try {
        await dashboardsRepo.removeByConnection(db, connectionId);
      } catch {
        // dashboards table may not exist yet
      }
    } catch (error) {
      console.error(`Failed to remove data for connection ${connectionId}:`, error);
    }
  }

  // === LEGACY CONNECTION STATE (for migration) ===

  async loadLegacyConnectionState(connectionId: string): Promise<{
    queryTabs: PersistedQueryTab[];
    schemaTabs: PersistedSchemaTab[];
    explainTabs: PersistedExplainTab[];
    erdTabs: PersistedErdTab[];
    tabOrder: string[];
    activeQueryTabId: string | null;
    activeSchemaTabId: string | null;
    activeExplainTabId: string | null;
    activeErdTabId: string | null;
    activeView: "query" | "schema" | "explain" | "erd";
    savedQueries: PersistedSavedQuery[];
    queryHistory: PersistedQueryHistoryItem[];
  } | null> {
    try {
      const { loadStore } = await import("$lib/storage/legacy");
      const store = await loadStore(`connection_state_${connectionId}.json`, {
        autoSave: false,
        defaults: { state: null },
      });
      const state = await store.get("state");
      if (!state) return null;
      return state as {
        queryTabs: PersistedQueryTab[];
        schemaTabs: PersistedSchemaTab[];
        explainTabs: PersistedExplainTab[];
        erdTabs: PersistedErdTab[];
        tabOrder: string[];
        activeQueryTabId: string | null;
        activeSchemaTabId: string | null;
        activeExplainTabId: string | null;
        activeErdTabId: string | null;
        activeView: "query" | "schema" | "explain" | "erd";
        savedQueries: PersistedSavedQuery[];
        queryHistory: PersistedQueryHistoryItem[];
      };
    } catch {
      return null;
    }
  }

  async removeLegacyConnectionState(connectionId: string): Promise<void> {
    try {
      const { loadStore } = await import("$lib/storage/legacy");
      const store = await loadStore(`connection_state_${connectionId}.json`, {
        autoSave: false,
        defaults: { state: null },
      });
      await store.delete();
    } catch {
      // Ignore errors when removing legacy state
    }
  }

  // === CONNECTION PERSISTENCE ===

  stripPasswordFromConnectionString(connectionString?: string): string | undefined {
    if (!connectionString) return undefined;

    try {
      // Handle SQLite
      if (connectionString.startsWith("sqlite://") || connectionString.startsWith("sqlite:")) {
        return connectionString;
      }

      // Parse URL-based connection strings
      let normalized = connectionString.replace("postgresql://", "postgres://");
      const url = new URL(normalized);

      // Remove password from URL
      if (url.password) {
        url.password = "";
      }

      return url.toString().replace("postgres://", "postgresql://");
    } catch {
      // If parsing fails, return original string (it might not be a URL)
      return connectionString;
    }
  }

  async persistConnection(
    connection: DatabaseConnection,
    options?: {
      savePassword?: boolean;
      saveSshPassword?: boolean;
      saveSshKeyPassphrase?: boolean;
      sshPassword?: string;
      sshKeyPassphrase?: string;
    },
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const db = await getDatabase();

        const persistedConnection: PersistedConnection = {
          id: connection.id,
          name: connection.name,
          type: connection.type,
          host: connection.host,
          port: connection.port,
          databaseName: connection.databaseName,
          username: connection.username,
          sslMode: connection.sslMode,
          connectionString: this.stripPasswordFromConnectionString(connection.connectionString),
          lastConnected: connection.lastConnected,
          sshTunnel: connection.sshTunnel,
          savePassword: options?.savePassword,
          saveSshPassword: options?.saveSshPassword,
          saveSshKeyPassphrase: options?.saveSshKeyPassphrase,
          projectId: connection.projectId,
          labelIds: connection.labelIds,
          isLocalOnly: connection.isLocalOnly,
          sharedConnectionId: connection.sharedConnectionId,
        };

        await connectionsRepo.save(db, persistedConnection);

        // Save passwords to keyring if enabled
        const keyring = getKeyringService();
        if (keyring.isAvailable()) {
          await withErrorHandling(
            async () => {
              if (options?.savePassword && connection.password) {
                await keyring.setDbPassword(connection.id, connection.password);
              } else if (!options?.savePassword) {
                await keyring.deleteDbPassword(connection.id);
              }

              if (options?.saveSshPassword && options.sshPassword) {
                await keyring.setSshPassword(connection.id, options.sshPassword);
              } else if (!options?.saveSshPassword) {
                await keyring.deleteSshPassword(connection.id);
              }

              if (options?.saveSshKeyPassphrase && options.sshKeyPassphrase) {
                await keyring.setSshKeyPassphrase(connection.id, options.sshKeyPassphrase);
              } else if (!options?.saveSshKeyPassphrase) {
                await keyring.deleteSshKeyPassphrase(connection.id);
              }
            },
            "PERSISTENCE_FAILED",
            "Could not save password to system keychain",
          );
        }
      },
      "PERSISTENCE_FAILED",
      "Failed to save connection to storage",
    );
  }

  async removePersistedConnection(connectionId: string): Promise<void> {
    await withErrorHandling(
      async () => {
        const db = await getDatabase();
        await connectionsRepo.remove(db, connectionId);

        // Delete passwords from keyring
        const keyring = getKeyringService();
        if (keyring.isAvailable()) {
          try {
            await keyring.deleteAllForConnection(connectionId);
          } catch (error) {
            console.warn("Failed to delete credentials from keyring:", error);
          }
        }

        // Remove connection data
        await this.removeConnectionData(connectionId);
      },
      "PERSISTENCE_FAILED",
      "Failed to delete connection from storage",
    );
  }

  async loadPersistedConnections(): Promise<PersistedConnection[]> {
    try {
      const db = await getDatabase();
      return await connectionsRepo.loadAll(db);
    } catch (error) {
      console.error("Failed to load persisted connections:", error);
      return [];
    }
  }

  // === SHARED QUERY REPOS PERSISTENCE ===

  async persistSharedRepos(): Promise<void> {
    try {
      const db = await getDatabase();
      const repos: PersistedSharedQueryRepo[] = this.state.sharedRepos.map(serializeRepo);
      await sharedReposRepo.saveAll(db, repos, this.state.activeRepoId);
    } catch (error) {
      console.error("Failed to persist shared repos:", error);
    }
  }

  async loadSharedRepos(): Promise<{
    repos: PersistedSharedQueryRepo[];
    activeRepoId: string | null;
  }> {
    try {
      const db = await getDatabase();
      return await sharedReposRepo.loadAll(db);
    } catch (error) {
      console.error("Failed to load shared repos:", error);
      return { repos: [], activeRepoId: null };
    }
  }

  // === CONNECTION OVERRIDES PERSISTENCE ===

  async persistConnectionOverride(override: ConnectionOverride): Promise<void> {
    try {
      const db = await getDatabase();
      await connectionOverridesRepo.save(db, {
        sharedConnectionId: override.sharedConnectionId,
        username: override.username,
        hostOverride: override.hostOverride,
        portOverride: override.portOverride,
        savePassword: override.savePassword,
        saveSshPassword: override.saveSshPassword,
        saveSshKeyPassphrase: override.saveSshKeyPassphrase,
      });
    } catch (error) {
      console.error("Failed to persist connection override:", error);
    }
  }

  async loadConnectionOverrides(): Promise<Record<string, ConnectionOverride>> {
    try {
      const db = await getDatabase();
      const overrides = await connectionOverridesRepo.loadAll(db);
      const result: Record<string, ConnectionOverride> = {};
      for (const o of overrides) {
        result[o.sharedConnectionId] = {
          sharedConnectionId: o.sharedConnectionId,
          username: o.username,
          hostOverride: o.hostOverride,
          portOverride: o.portOverride,
          savePassword: o.savePassword,
          saveSshPassword: o.saveSshPassword,
          saveSshKeyPassphrase: o.saveSshKeyPassphrase,
        };
      }
      return result;
    } catch (error) {
      console.error("Failed to load connection overrides:", error);
      return {};
    }
  }

  async removeConnectionOverride(sharedConnectionId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await connectionOverridesRepo.remove(db, sharedConnectionId);
    } catch (error) {
      console.error("Failed to remove connection override:", error);
    }
  }

  // === STORAGE VERSION ===

  async getStorageVersion(): Promise<number> {
    try {
      const db = await getDatabase();
      const rows = await db.query<{ version: number }>(
        "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
      );
      return rows.length > 0 ? rows[0].version : 0;
    } catch {
      return 0;
    }
  }

  async setStorageVersion(version: number): Promise<void> {
    try {
      const db = await getDatabase();
      await db.execute("INSERT INTO schema_version (version) VALUES (?)", [version]);
    } catch (error) {
      console.error("Failed to set storage version:", error);
    }
  }
}
