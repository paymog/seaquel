import type {
  Project,
  PersistedProjectState,
  PersistedQueryTab,
  PersistedSchemaTab,
  PersistedExplainTab,
  PersistedErdTab,
  PersistedQueryHistoryItem,
} from "$lib/types";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME } from "$lib/types";
import type { PersistenceManager } from "./persistence-manager.svelte.js";
import type { PersistedConnection } from "./types.js";
import {
  getDatabase,
  projectsRepo,
  connectionsRepo,
  projectStateRepo,
  savedQueriesRepo,
  queryHistoryRepo,
  CURRENT_STORAGE_VERSION,
} from "$lib/storage";
import { log } from "$lib/utils/logger";

export { CURRENT_STORAGE_VERSION };

/**
 * Handles data migration between storage versions.
 * Version 1: Original format with per-connection tabs (JSON)
 * Version 2: Projects format with per-project tabs (SQLite)
 */
export class MigrationManager {
  constructor(private persistence: PersistenceManager) {}

  /**
   * Check storage version and run migrations if needed.
   * Should be called on app startup before loading data.
   */
  async migrateIfNeeded(): Promise<void> {
    const version = await this.persistence.getStorageVersion();

    if (version < CURRENT_STORAGE_VERSION) {
      void log.info(`Migrating storage from version ${version} to ${CURRENT_STORAGE_VERSION}`);

      if (version < 2) {
        await this.migrateToV2();
      }

      if (version < 3) {
        await this.migrateToV3();
      }

      if (version < 4) {
        await this.migrateToV4();
      }

      await this.persistence.setStorageVersion(CURRENT_STORAGE_VERSION);
      void log.info("Migration completed successfully");
    }
  }

  /**
   * Migrate from v1 (per-connection tabs) to v2 (per-project tabs).
   *
   * Changes:
   * 1. Create default "Seaquel" project
   * 2. Assign all connections to default project with empty labelIds
   * 3. Merge all connection tabs into single project state
   * 4. Separate saved queries and history into connection_data tables
   * 5. Remove old connection_state files
   */
  private async migrateToV2(): Promise<void> {
    void log.info("Running migration to v2 (projects)...");

    // 1. Load existing connections
    const connections = await this.persistence.loadPersistedConnections();

    if (connections.length === 0) {
      // No connections to migrate, just create default project
      void log.info("No existing connections, creating default project");
      await this.createDefaultProject();
      return;
    }

    // 2. Create default project
    await this.createDefaultProject();

    // 3. Update connections with projectId and labelIds
    const db = await getDatabase();
    const updatedConnections: PersistedConnection[] = connections.map((conn) => ({
      ...conn,
      projectId: conn.projectId || DEFAULT_PROJECT_ID,
      labelIds: conn.labelIds || [],
    }));

    // Save updated connections to SQLite
    for (const conn of updatedConnections) {
      await connectionsRepo.save(db, conn);
    }

    // 4. Load and merge all connection states
    const mergedState = await this.mergeConnectionStates(updatedConnections);

    // 5. Save merged project state
    if (mergedState) {
      await projectStateRepo.save(db, mergedState);
    }

    // 6. Migrate saved queries and history to SQLite tables
    for (const conn of connections) {
      await this.migrateConnectionData(conn.id);
    }

    void log.info(
      `Migrated ${connections.length} connections to project "${DEFAULT_PROJECT_NAME}"`,
    );
  }

  /**
   * Create the default project.
   */
  private async createDefaultProject(): Promise<Project> {
    const now = new Date();
    const project: Project = {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      createdAt: now,
      updatedAt: now,
      customLabels: [],
    };

    const db = await getDatabase();
    await projectsRepo.save(db, {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      customLabels: [],
    });

    return project;
  }

  /**
   * Merge all connection states into a single project state.
   */
  private async mergeConnectionStates(
    connections: PersistedConnection[],
  ): Promise<PersistedProjectState | null> {
    const allQueryTabs: PersistedQueryTab[] = [];
    const allSchemaTabs: PersistedSchemaTab[] = [];
    const allExplainTabs: PersistedExplainTab[] = [];
    const allErdTabs: PersistedErdTab[] = [];
    const allTabOrder: string[] = [];
    let activeView: "query" | "schema" | "explain" | "erd" = "query";
    let activeQueryTabId: string | null = null;
    let activeSchemaTabId: string | null = null;
    let activeExplainTabId: string | null = null;
    let activeErdTabId: string | null = null;
    let activeConnectionId: string | null = null;

    // Find the most recently connected connection to use as active
    const sortedConnections = [...connections].sort((a, b) => {
      const aTime = a.lastConnected ? new Date(a.lastConnected).getTime() : 0;
      const bTime = b.lastConnected ? new Date(b.lastConnected).getTime() : 0;
      return bTime - aTime;
    });

    for (const conn of sortedConnections) {
      const legacyState = await this.persistence.loadLegacyConnectionState(conn.id);
      if (!legacyState) continue;

      // Merge tabs
      allQueryTabs.push(...legacyState.queryTabs);
      allSchemaTabs.push(...legacyState.schemaTabs);
      allExplainTabs.push(...legacyState.explainTabs);
      allErdTabs.push(...legacyState.erdTabs);
      allTabOrder.push(...legacyState.tabOrder);

      // Use the first connection's active state
      if (!activeConnectionId) {
        activeConnectionId = conn.id;
        activeView = legacyState.activeView;
        activeQueryTabId = legacyState.activeQueryTabId;
        activeSchemaTabId = legacyState.activeSchemaTabId;
        activeExplainTabId = legacyState.activeExplainTabId;
        activeErdTabId = legacyState.activeErdTabId;
      }
    }

    if (allQueryTabs.length === 0 && allSchemaTabs.length === 0) {
      return null;
    }

    return {
      projectId: DEFAULT_PROJECT_ID,
      queryTabs: allQueryTabs,
      schemaTabs: allSchemaTabs,
      explainTabs: allExplainTabs,
      erdTabs: allErdTabs,
      tabOrder: allTabOrder,
      activeQueryTabId,
      activeSchemaTabId,
      activeExplainTabId,
      activeErdTabId,
      activeView,
      activeConnectionId,
    };
  }

  /**
   * Migrate to v3: Add dashboards table and active_dashboard_tab_id column.
   */
  private async migrateToV3(): Promise<void> {
    void log.info("Running migration to v3 (dashboards)...");

    const db = await getDatabase();

    // Create dashboards table
    await db.execute(`CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      viewport TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
      widgets TEXT NOT NULL DEFAULT '[]',
      date_filter TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_dashboards_connection ON dashboards(connection_id)`,
    );

    // Add active_dashboard_tab_id column to project_state
    try {
      await db.execute(`ALTER TABLE project_state ADD COLUMN active_dashboard_tab_id TEXT`);
    } catch {
      // Column may already exist
    }

    void log.info("Migration to v3 completed");
  }

  /**
   * Migrate to v4: Add pane_layout column to project_state for split pane persistence.
   */
  private async migrateToV4(): Promise<void> {
    void log.info("Running migration to v4 (pane layout)...");

    const db = await getDatabase();

    try {
      await db.execute(`ALTER TABLE project_state ADD COLUMN pane_layout TEXT`);
    } catch {
      // Column may already exist
    }

    void log.info("Migration to v4 completed");
  }

  /**
   * Migrate saved queries and history from legacy connection state to SQLite tables.
   */
  private async migrateConnectionData(connectionId: string): Promise<void> {
    const legacyState = await this.persistence.loadLegacyConnectionState(connectionId);
    if (!legacyState) return;

    const { savedQueries, queryHistory } = legacyState;

    if (savedQueries.length > 0 || queryHistory.length > 0) {
      const db = await getDatabase();

      // Add missing fields to history items for backwards compatibility
      const migratedHistory: PersistedQueryHistoryItem[] = queryHistory.map((h) => ({
        ...h,
        connectionLabelsSnapshot: (h as any).connectionLabelsSnapshot || [],
        connectionNameSnapshot: (h as any).connectionNameSnapshot || "",
      }));

      // Resolve projectId from connection for migration
      const connRows = await db.query<{ project_id: string }>(
        "SELECT project_id FROM connections WHERE id = ?",
        [connectionId],
      );
      const projectId = connRows.length > 0 ? connRows[0].project_id : DEFAULT_PROJECT_ID;
      // Remap connectionId → projectId on migrated saved queries
      const migratedQueries = savedQueries.map((q) => ({
        ...q,
        projectId,
      }));
      await savedQueriesRepo.saveAll(db, projectId, migratedQueries);
      await queryHistoryRepo.replaceAll(db, connectionId, migratedHistory);
    }

    // Remove legacy connection state file
    await this.persistence.removeLegacyConnectionState(connectionId);
  }
}
