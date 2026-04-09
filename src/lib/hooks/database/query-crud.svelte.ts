import type { PendingChangeOrigin, PendingChangeTarget } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { ProviderRegistry } from "$lib/providers";
import type { PendingChangesManager } from "./pending-changes.svelte.js";
import { extractErrorMessage } from "$lib/errors";
import { log } from "$lib/utils/logger";
import { getAdapter } from "$lib/db/index";
import { describePendingChange } from "$lib/db/pending-change-description";
import type { CastLookup } from "$lib/db/crud-helpers";

type CrudResult = { success: boolean; error?: string; queued?: boolean };

/**
 * Handles CRUD operations (insert, update, delete) and raw query execution.
 * Extracted from QueryExecutionManager for readability.
 */
export class QueryCrudManager {
  constructor(
    private state: DatabaseState,
    private providers: ProviderRegistry,
    private pendingChanges: PendingChangesManager,
  ) {}

  /**
   * Build a CastLookup callback for a given table, used by parameterized adapters
   * (e.g. Postgres) to wrap bind placeholders in CAST($N AS type).
   */
  buildCastLookup(schema: string, tableName: string): CastLookup | undefined {
    const connectionId = this.state.activeConnectionId;
    if (!connectionId) return undefined;
    const tables = this.state.schemas[connectionId] ?? [];
    const table = tables.find((t) => t.name === tableName && t.schema === schema);
    if (!table) return undefined;
    return (col: string) => {
      const colDef = table.columns.find((c) => c.name === col);
      if (!colDef) return undefined;
      const colType = colDef.type.toLowerCase();
      if (["text", "character varying", "character"].includes(colType)) return undefined;
      if (["user-defined", "array"].includes(colType)) return undefined;
      return colDef.type;
    };
  }

  /**
   * Update a single cell value directly.
   * Used by the data viewer for inline cell editing and by updateCell (query tab version).
   */
  async updateCellDirect(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
    column: string,
    newValue: unknown,
    options?: { deduplicatePending?: boolean },
  ): Promise<CrudResult> {
    if (sourceTable.primaryKeys.length === 0) {
      return { success: false, error: "No primary key found" };
    }

    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      return { success: false, error: "No connection established" };
    }

    try {
      const provider = await this.providers.getForType(connection.type);
      const adapter = getAdapter(connection.type);
      const castLookup = this.buildCastLookup(sourceTable.schema, sourceTable.name);
      const { sql: query, bindValues } = adapter.buildUpdateSql(
        sourceTable.schema,
        sourceTable.name,
        column,
        newValue,
        sourceTable.primaryKeys,
        row,
        castLookup,
      );

      if (this.pendingChanges.isEnabled()) {
        const pkValues = Object.fromEntries(sourceTable.primaryKeys.map((pk) => [pk, row[pk]]));
        const target: PendingChangeTarget = {
          schema: sourceTable.schema,
          table: sourceTable.name,
          column,
          primaryKeyValues: pkValues,
          newValue,
        };

        if (options?.deduplicatePending) {
          const existingChange = this.pendingChanges.findForCell(
            connection.id,
            sourceTable.schema,
            sourceTable.name,
            column,
            pkValues,
          );
          if (existingChange) {
            this.pendingChanges.update(connection.id, existingChange.id, {
              sql: query,
              bindValues,
              target,
              description: describePendingChange(query, "inline-edit"),
            });
            return { success: true, queued: true };
          }
        }

        this.pendingChanges.add(
          connection.id,
          query,
          "update",
          "inline-edit",
          undefined,
          bindValues,
          target,
        );
        return { success: true, queued: true };
      }

      await provider.execute(connection.providerConnectionId, query, bindValues);
      return { success: true };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  /**
   * Set a cell to its column DEFAULT directly.
   * Used by the data viewer and by setCellDefault (query tab version).
   */
  async setCellDefaultDirect(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
    column: string,
    options?: { deduplicatePending?: boolean },
  ): Promise<CrudResult> {
    if (sourceTable.primaryKeys.length === 0) {
      return { success: false, error: "No primary key found" };
    }

    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      return { success: false, error: "No connection established" };
    }

    try {
      const provider = await this.providers.getForType(connection.type);
      const adapter = getAdapter(connection.type);
      const { sql: query, bindValues } = adapter.buildSetDefaultSql(
        sourceTable.schema,
        sourceTable.name,
        column,
        sourceTable.primaryKeys,
        row,
      );

      if (this.pendingChanges.isEnabled()) {
        const pkV = Object.fromEntries(sourceTable.primaryKeys.map((pk) => [pk, row[pk]]));
        const t: PendingChangeTarget = {
          schema: sourceTable.schema,
          table: sourceTable.name,
          column,
          primaryKeyValues: pkV,
        };

        if (options?.deduplicatePending) {
          const existingChange = this.pendingChanges.findForCell(
            connection.id,
            sourceTable.schema,
            sourceTable.name,
            column,
            pkV,
          );
          if (existingChange) {
            this.pendingChanges.update(connection.id, existingChange.id, {
              sql: query,
              bindValues,
              target: t,
              description: describePendingChange(query, "set-default"),
            });
            return { success: true, queued: true };
          }
        }

        this.pendingChanges.add(
          connection.id,
          query,
          "update",
          "set-default",
          undefined,
          bindValues,
          t,
        );
        return { success: true, queued: true };
      }

      await provider.execute(connection.providerConnectionId, query, bindValues);
      return { success: true };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  /**
   * Insert a new row into the database.
   */
  async insertRow(
    sourceTable: { schema: string; name: string },
    values: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string; lastInsertId?: number; queued?: boolean }> {
    const columns = Object.keys(values);
    if (columns.length === 0) {
      return { success: false, error: "No values provided" };
    }

    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      return { success: false, error: "No connection established" };
    }

    void log.debug(`Row insert on ${connection?.id}`);
    try {
      const provider = await this.providers.getForType(connection.type);
      const adapter = getAdapter(connection.type);
      const castLookup = this.buildCastLookup(sourceTable.schema, sourceTable.name);
      const { sql: query, bindValues } = adapter.buildInsertSql(
        sourceTable.schema,
        sourceTable.name,
        values,
        castLookup,
      );

      if (this.pendingChanges.isEnabled()) {
        const target: PendingChangeTarget = {
          schema: sourceTable.schema,
          table: sourceTable.name,
          insertValues: values,
        };
        this.pendingChanges.add(
          connection.id,
          query,
          "insert",
          "insert-row",
          undefined,
          bindValues,
          target,
        );
        return { success: true, queued: true };
      }

      const result = await provider.execute(connection.providerConnectionId, query, bindValues);
      return { success: true, lastInsertId: result?.lastInsertId };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  /**
   * Delete a row from the database.
   */
  async deleteRow(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
  ): Promise<CrudResult> {
    if (sourceTable.primaryKeys.length === 0) {
      return { success: false, error: "No primary key found" };
    }

    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      return { success: false, error: "No connection established" };
    }

    void log.debug(`Row delete on ${connection?.id}`);
    try {
      const provider = await this.providers.getForType(connection.type);
      const adapter = getAdapter(connection.type);
      const { sql: query, bindValues } = adapter.buildDeleteSql(
        sourceTable.schema,
        sourceTable.name,
        sourceTable.primaryKeys,
        row,
      );

      if (this.pendingChanges.isEnabled()) {
        const delPk = Object.fromEntries(sourceTable.primaryKeys.map((pk) => [pk, row[pk]]));
        const delTgt: PendingChangeTarget = {
          schema: sourceTable.schema,
          table: sourceTable.name,
          primaryKeyValues: delPk,
        };
        this.pendingChanges.add(
          connection.id,
          query,
          "delete",
          "delete-row",
          undefined,
          bindValues,
          delTgt,
        );
        return { success: true, queued: true };
      }

      await provider.execute(connection.providerConnectionId, query, bindValues);
      return { success: true };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  /**
   * Execute a raw query and return results directly.
   * Used by statistics dashboard and other features that need raw query results.
   */
  async executeRaw(query: string): Promise<Record<string, unknown>[]> {
    const connection = this.state.activeConnection;
    const isConnected = !!connection?.providerConnectionId;
    if (!connection || !isConnected) {
      throw new Error("Not connected to database");
    }

    const provider = await this.providers.getForType(connection.type);
    return await provider.select<Record<string, unknown>>(connection.providerConnectionId!, query);
  }

  /**
   * Execute a raw DDL/write statement on the active connection.
   * Used for CREATE TABLE, DROP TABLE, ALTER TABLE, TRUNCATE, etc.
   */
  async executeRawDdl(query: string): Promise<{ queued?: boolean }> {
    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      throw new Error("Not connected to database");
    }

    if (this.pendingChanges.isEnabled()) {
      const upper = query.trimStart().toUpperCase();
      let origin: PendingChangeOrigin;
      if (upper.startsWith("TRUNCATE")) origin = "truncate-table";
      else if (upper.startsWith("ALTER TABLE")) origin = "alter-table";
      else if (upper.startsWith("CREATE TABLE")) origin = "create-table";
      else if (upper.startsWith("DROP TABLE")) origin = "drop-table";
      else origin = "query-editor";
      this.pendingChanges.add(connection.id, query, "other", origin);
      return { queued: true };
    }

    const provider = await this.providers.getForType(connection.type);
    await provider.execute(connection.providerConnectionId, query);
    return {};
  }
}
