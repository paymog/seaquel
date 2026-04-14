import type { SchemaTable, SchemaTab } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";
import { getAdapter, type DatabaseAdapter } from "$lib/db";
import type { ProviderRegistry, DatabaseProvider } from "$lib/providers";
import { handleError, createError } from "$lib/errors";
import { log } from "$lib/utils/logger";

/**
 * Manages schema tabs: add, remove, set active.
 * Handles table metadata loading.
 * Tabs are organized per-project.
 */
export class SchemaTabManager extends BaseTabManager<SchemaTab> {
  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    private providers: ProviderRegistry,
  ) {
    super(state, tabOrdering, schedulePersistence);
  }

  protected get accessors(): TabStateAccessors<SchemaTab> {
    return {
      getTabs: () => this.state.schemaTabsByProject,
      setTabs: (r) => (this.state.schemaTabsByProject = r),
      getActiveId: () => this.state.activeSchemaTabIdByProject,
      setActiveId: (r) => (this.state.activeSchemaTabIdByProject = r),
    };
  }

  /**
   * Fetch columns, indexes, and foreign keys for a single table.
   * Returns an updated SchemaTable with metadata populated.
   */
  private async fetchTableMetadata(
    provider: DatabaseProvider,
    providerConnectionId: string,
    adapter: DatabaseAdapter,
    table: SchemaTable,
  ): Promise<SchemaTable> {
    const columnsResult = await provider.select(
      providerConnectionId,
      adapter.getColumnsQuery(table.name, table.schema),
    );

    const indexesResult = await provider.select(
      providerConnectionId,
      adapter.getIndexesQuery(table.name, table.schema),
    );

    let foreignKeysResult: unknown[] | undefined;
    if (adapter.getForeignKeysQuery) {
      foreignKeysResult = await provider.select(
        providerConnectionId,
        adapter.getForeignKeysQuery(table.name, table.schema),
      );
    }

    return {
      ...table,
      columns: adapter.parseColumnsResult(columnsResult || [], foreignKeysResult),
      indexes: adapter.parseIndexesResult(indexesResult || []),
    };
  }

  /**
   * Add a schema tab for the specified table.
   * Fetches table metadata (columns, indexes, foreign keys).
   */
  async add(table: SchemaTable): Promise<string | null> {
    if (
      !this.state.activeProjectId ||
      !this.state.activeConnectionId ||
      !this.state.activeConnection
    )
      return null;

    const connectionId = this.state.activeConnectionId;
    const tabs = this.getProjectTabs();

    // Use cached metadata from the schema store (populated at connection time)
    const cached = (this.state.schemas[connectionId] ?? []).find(
      (t) => t.name === table.name && t.schema === table.schema,
    );
    const tableWithMetadata = cached ?? table;

    // Check if table is already open on the active connection
    const existingTab = tabs.find(
      (t) =>
        t.connectionId === connectionId &&
        t.table.name === table.name &&
        t.table.schema === table.schema,
    );
    if (existingTab) {
      this.updateTab(existingTab.id, (t) => ({ ...t, table: tableWithMetadata }));
      this.setActive(existingTab.id);
      return existingTab.id;
    }

    const newTab: SchemaTab = {
      id: `schema-tab-${crypto.randomUUID()}`,
      connectionId,
      table: tableWithMetadata,
    };

    const tabId = this.appendTab(newTab);

    // Refresh metadata in the background if columns aren't loaded yet
    if (tableWithMetadata.columns.length === 0) {
      void this.refreshTabMetadata(tabId, connectionId, table);
    }

    return tabId;
  }

  /**
   * Refresh a schema tab's metadata in the background.
   */
  private async refreshTabMetadata(
    tabId: string,
    connectionId: string,
    table: SchemaTable,
  ): Promise<void> {
    const connection = this.state.connections.find((c) => c.id === connectionId);
    if (!connection?.providerConnectionId) return;

    try {
      const adapter = getAdapter(connection.type);
      const provider = await this.providers.getForType(connection.type);
      const updatedTable = await this.fetchTableMetadata(
        provider,
        connection.providerConnectionId,
        adapter,
        table,
      );

      // Update schema cache
      const connectionSchemas = [...(this.state.schemas[connectionId] ?? [])];
      const tableIndex = connectionSchemas.findIndex(
        (t) => t.name === table.name && t.schema === table.schema,
      );
      if (tableIndex >= 0) {
        connectionSchemas[tableIndex] = updatedTable;
      }
      this.state.schemas = {
        ...this.state.schemas,
        [connectionId]: connectionSchemas,
      };

      // Update the open tab
      this.updateTab(tabId, (t) => ({ ...t, table: updatedTable }));
    } catch {
      // Silently fail — the tab still shows whatever we had cached
    }
  }

  /**
   * Load column and index metadata for all tables in the background.
   * Updates the schema state progressively as each table's metadata is loaded.
   */
  async loadTableMetadataInBackground(
    connectionId: string,
    tables: SchemaTable[],
    adapter: DatabaseAdapter,
    providerConnectionId?: string,
  ): Promise<void> {
    if (!providerConnectionId) return;

    // Get provider once for all tables
    const connectionType = this.state.connections.find((c) => c.id === connectionId)?.type;
    const provider = await this.providers.getForType(connectionType ?? "");

    void log.debug(`Loading metadata for ${tables.length} tables on ${connectionId}`);
    // Process tables in parallel but update state as each completes
    const promises = tables.map(async (table, index) => {
      try {
        const updatedTable = await this.fetchTableMetadata(
          provider,
          providerConnectionId,
          adapter,
          table,
        );

        // Update the schema state with the new table metadata
        const currentSchemas = this.state.schemas[connectionId];
        if (currentSchemas) {
          const updatedSchemas = [...currentSchemas];
          updatedSchemas[index] = updatedTable;
          this.state.schemas = {
            ...this.state.schemas,
            [connectionId]: updatedSchemas,
          };
        }
      } catch (error) {
        void log.error(`Metadata load failed for ${connectionId}`);
        handleError(
          createError(
            "SCHEMA_LOAD_FAILED",
            error instanceof Error ? error.message : String(error),
            `Failed to load metadata for ${table.schema}.${table.name}`,
            { table: table.name, schema: table.schema },
          ),
          { silent: true },
        );
      }
    });

    await Promise.allSettled(promises);
    void log.debug(`Metadata loaded for ${connectionId}`);
  }
}
