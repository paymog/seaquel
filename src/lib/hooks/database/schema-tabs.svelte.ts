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
   *
   * Tables that already have column metadata (e.g. restored from cache) are
   * skipped entirely. Remaining tables are processed in bounded-concurrency
   * batches so we don't overwhelm the connection pool or trigger thousands of
   * individual reactive state updates.
   */
  async loadTableMetadataInBackground(
    connectionId: string,
    tables: SchemaTable[],
    adapter: DatabaseAdapter,
    providerConnectionId?: string,
    force?: boolean,
  ): Promise<void> {
    if (!providerConnectionId) return;

    const connectionType = this.state.connections.find((c) => c.id === connectionId)?.type;
    const provider = await this.providers.getForType(connectionType ?? "");

    // Only load metadata for tables that don't already have columns
    // (unless force is true, e.g. manual schema refresh)
    const pending: { table: SchemaTable; index: number }[] = [];
    for (let i = 0; i < tables.length; i++) {
      if (force || !tables[i].columns || tables[i].columns.length === 0) {
        pending.push({ table: tables[i], index: i });
      }
    }

    if (pending.length === 0) {
      void log.debug(`All ${tables.length} tables already have metadata for ${connectionId}`);
      return;
    }

    void log.debug(`Loading metadata for ${pending.length}/${tables.length} tables on ${connectionId}`);

    // Process in bounded-concurrency batches; one state update per batch
    const BATCH_SIZE = 50;
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(({ table }) =>
          this.fetchTableMetadata(provider, providerConnectionId, adapter, table),
        ),
      );

      const currentSchemas = this.state.schemas[connectionId];
      if (!currentSchemas) continue;

      const updatedSchemas = [...currentSchemas];
      let changed = false;
      for (let j = 0; j < results.length; j++) {
        const { table, index } = batch[j];
        const result = results[j];
        if (result.status === "fulfilled") {
          updatedSchemas[index] = result.value;
          changed = true;
        } else {
          void log.error(`Metadata load failed for ${connectionId}/${table.schema}.${table.name}`);
          handleError(
            createError(
              "SCHEMA_LOAD_FAILED",
              result.reason instanceof Error ? result.reason.message : String(result.reason),
              `Failed to load metadata for ${table.schema}.${table.name}`,
              { table: table.name, schema: table.schema },
            ),
            { silent: true },
          );
        }
      }

      if (changed) {
        this.state.schemas = {
          ...this.state.schemas,
          [connectionId]: updatedSchemas,
        };
      }
    }

    void log.debug(`Metadata loaded for ${connectionId}`);
  }
}
