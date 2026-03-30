import type {
  CreateTableTab,
  CreateTableDefinition,
  SchemaTable,
  ActiveViewType,
} from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";
import { getAdapter } from "$lib/db";
import type { ProviderRegistry } from "$lib/providers";
import { toast } from "svelte-sonner";

/**
 * Manages create table tabs: add, remove, set active.
 * Handles DDL generation and execution.
 */
export class CreateTableTabManager extends BaseTabManager<CreateTableTab> {
  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (view: ActiveViewType) => void,
    private providers: ProviderRegistry,
    private refreshSchemaFn: (connectionId: string) => Promise<void>,
  ) {
    super(state, tabOrdering, schedulePersistence, setActiveView);
  }

  protected get accessors(): TabStateAccessors<CreateTableTab> {
    return {
      getTabs: () => this.state.createTableTabsByProject,
      setTabs: (r) => (this.state.createTableTabsByProject = r),
      getActiveId: () => this.state.activeCreateTableTabIdByProject,
      setActiveId: (r) => (this.state.activeCreateTableTabIdByProject = r),
    };
  }

  /**
   * Open a new Create Table tab with an empty definition.
   */
  add(schemaName?: string): string | null {
    if (!this.state.activeProjectId || !this.state.activeConnectionId) return null;

    const schemas = [...new Set(this.state.activeSchema.map((t) => t.schema))];
    const defaultSchema = schemaName ?? schemas[0] ?? "";
    const definition: CreateTableDefinition = {
      tableName: "",
      schemaName: defaultSchema,
      columns: [
        {
          id: crypto.randomUUID(),
          name: "id",
          type: "INTEGER",
          nullable: false,
          defaultValue: "",
          isPrimaryKey: true,
          isUnique: false,
        },
      ],
      indexes: [],
      foreignKeys: [],
    };

    const tab: CreateTableTab = {
      id: `create-table-${crypto.randomUUID()}`,
      connectionId: this.state.activeConnectionId,
      name: "New Table",
      tableDefinition: definition,
      generatedSql: undefined,
    };

    return this.appendTab(tab);
  }

  /**
   * Open a Create Table tab pre-populated from an existing table's schema.
   */
  addFromTable(table: SchemaTable): string | null {
    if (!this.state.activeProjectId || !this.state.activeConnectionId) return null;

    const definition: CreateTableDefinition = {
      tableName: table.name,
      schemaName: table.schema,
      columns: table.columns.map((col) => {
        // Split type and length/precision: "varchar(255)" → type="varchar", length="255"
        const typeMatch = col.type.match(/^([^(]+)\(([^)]+)\)/);
        let type = col.type;
        let length: string | undefined;
        let precision: string | undefined;

        if (typeMatch) {
          type = typeMatch[1].trim();
          const params = typeMatch[2].trim();
          if (params.includes(",")) {
            precision = params;
          } else {
            length = params;
          }
        }

        return {
          id: crypto.randomUUID(),
          name: col.name,
          type,
          length,
          precision,
          nullable: col.nullable,
          defaultValue: col.defaultValue ?? "",
          isPrimaryKey: col.isPrimaryKey,
          isUnique: false,
        };
      }),
      indexes: table.indexes.map((idx) => ({
        id: crypto.randomUUID(),
        name: idx.name,
        columns: [...idx.columns],
        unique: idx.unique,
        type: idx.type,
      })),
      foreignKeys: table.columns
        .filter((col) => col.isForeignKey && col.foreignKeyRef)
        .map((col) => ({
          id: crypto.randomUUID(),
          column: col.name,
          referencedSchema: col.foreignKeyRef!.referencedSchema,
          referencedTable: col.foreignKeyRef!.referencedTable,
          referencedColumn: col.foreignKeyRef!.referencedColumn,
        })),
    };

    // Deep-clone the definition so edits don't mutate the original
    const originalDefinition: CreateTableDefinition = JSON.parse(JSON.stringify(definition));

    const tab: CreateTableTab = {
      id: `create-table-${crypto.randomUUID()}`,
      connectionId: this.state.activeConnectionId,
      name: table.name,
      tableDefinition: definition,
      generatedSql: undefined,
      isEditMode: true,
      originalDefinition,
    };

    return this.appendTab(tab);
  }

  /**
   * Update the table definition for a tab.
   */
  updateDefinition(
    tabId: string,
    updater: (def: CreateTableDefinition) => CreateTableDefinition,
  ): void {
    this.updateTab(tabId, (tab) => {
      const updated = updater(tab.tableDefinition);
      return {
        ...tab,
        tableDefinition: updated,
        name: updated.tableName || "New Table",
      };
    });
    this.schedulePersistence(this.state.activeProjectId);
  }

  /**
   * Generate the CREATE TABLE SQL from the current definition.
   */
  generateSql(tabId: string): string | null {
    const tab = this.getProjectTabs().find((t) => t.id === tabId);
    if (!tab) return null;

    const connection = this.state.connections.find((c) => c.id === tab.connectionId);
    if (!connection) return null;

    const adapter = getAdapter(connection.type);
    if (!adapter.generateCreateTableSql) return null;

    const sql = adapter.generateCreateTableSql(tab.tableDefinition);
    this.updateTab(tabId, (t) => ({ ...t, generatedSql: sql }));
    return sql;
  }

  /**
   * Execute the CREATE TABLE DDL and refresh the schema.
   */
  async executeCreate(tabId: string): Promise<boolean> {
    const tab = this.getProjectTabs().find((t) => t.id === tabId);
    if (!tab) return false;

    const connection = this.state.connections.find((c) => c.id === tab.connectionId);
    if (!connection?.providerConnectionId) return false;

    const adapter = getAdapter(connection.type);

    let sql: string;
    if (tab.isEditMode && tab.originalDefinition && adapter.generateAlterTableSql) {
      sql = adapter.generateAlterTableSql(tab.originalDefinition, tab.tableDefinition);
      if (sql === "-- No changes detected") {
        toast.info("No changes to apply");
        return false;
      }
    } else {
      if (!adapter.generateCreateTableSql) return false;
      sql = adapter.generateCreateTableSql(tab.tableDefinition);
    }

    if (!sql) return false;

    try {
      const provider = await this.providers.getForType(connection.type);
      // ALTER TABLE may produce multiple statements separated by newlines
      const statements = sql
        .split(";\n")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("--"));
      for (const stmt of statements) {
        await provider.execute(
          connection.providerConnectionId,
          stmt.endsWith(";") ? stmt : stmt + ";",
        );
      }
      toast.success(
        tab.isEditMode
          ? `Table "${tab.tableDefinition.tableName}" updated successfully`
          : `Table "${tab.tableDefinition.tableName}" created successfully`,
      );
      await this.refreshSchemaFn(connection.id);
      return true;
    } catch (error) {
      toast.error(
        `Failed to ${tab.isEditMode ? "update" : "create"} table: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
