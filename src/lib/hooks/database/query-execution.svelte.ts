import { toast } from "svelte-sonner";
import { errorToast } from "$lib/utils/toast";
import type { DatabaseConnection, QueryResult, StatementResult, ParameterValue } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { QueryHistoryManager } from "./query-history.svelte.js";
import { detectQueryType, isSelectQuery, extractTableFromSelect } from "$lib/db/query-utils";
import { splitSqlStatements } from "$lib/db/sql-parser";
import { substituteParameters } from "$lib/db/query-params";
import { m } from "$lib/paraglide/messages.js";
import type { ProviderRegistry } from "$lib/providers";
import type { DatabaseProvider } from "$lib/providers/types";
import { extractErrorMessage } from "$lib/errors";
import { log } from "$lib/utils/logger";
import { resolveQuery } from "./resolve-query.js";
import type { PendingChangesManager } from "./pending-changes.svelte.js";
import type { PendingChangeOrigin } from "$lib/types";
import { getAdapter } from "$lib/db";
import { QueryCrudManager } from "./query-crud.svelte.js";

/**
 * Manages query execution, pagination, and CRUD operations.
 */
export class QueryExecutionManager {
  private readonly DEFAULT_PAGE_SIZE = 100;
  readonly crud: QueryCrudManager;

  constructor(
    private state: DatabaseState,
    private queryHistory: QueryHistoryManager,
    private providers: ProviderRegistry,
    private pendingChanges: PendingChangesManager,
  ) {
    this.crud = new QueryCrudManager(state, providers, pendingChanges);
  }

  /**
   * Update a query tab's state with proper Svelte 5 reactivity.
   */
  private updateQueryTabState(
    tabId: string,
    updates: Partial<{
      results: StatementResult[];
      activeResultIndex: number;
      isExecuting: boolean;
    }>,
  ): void {
    if (!this.state.activeProjectId) return;

    const projectId = this.state.activeProjectId;
    const tabs = this.state.queryTabsByProject[projectId];
    if (!tabs) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    Object.assign(tab, updates);
    // Trigger Svelte 5 reactivity by reassigning the top-level object
    this.state.queryTabsByProject = { ...this.state.queryTabsByProject };
  }

  /**
   * Create a standardized error result for failed statement execution.
   */
  private createErrorResult(
    statementSql: string,
    error: unknown,
    statementIndex: number,
    pageSize: number = 1,
  ): StatementResult {
    return {
      columns: ["Error"],
      rows: [{ Error: extractErrorMessage(error) }],
      rowCount: 1,
      totalRows: 1,
      executionTime: 0,
      page: 1,
      pageSize,
      totalPages: 1,
      statementIndex,
      statementSql,
      error: extractErrorMessage(error),
      isError: true,
    };
  }

  /**
   * Filter out utility results and re-index for display.
   * Keeps utility results only if ALL results are utility (so the user sees something).
   */
  private filterAndIndexResults(allResults: StatementResult[]): StatementResult[] {
    const displayResults = allResults.filter((r) => !r.isUtility);
    const results = displayResults.length > 0 ? displayResults : allResults;
    return results.map((r, idx) => ({ ...r, statementIndex: idx }));
  }

  /**
   * Get primary keys for a table.
   */
  getPrimaryKeysForTable(schema: string, tableName: string): string[] {
    if (!this.state.activeConnectionId) return [];
    const tables = this.state.schemas[this.state.activeConnectionId] ?? [];
    const table = tables.find((t) => t.name === tableName && t.schema === schema);
    if (!table) return [];
    return table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  }

  /**
   * Execute a single SQL statement and return the result.
   * @param sql The SQL statement to execute (may contain $1, $2, etc. placeholders)
   * @param page Page number for pagination
   * @param pageSize Number of rows per page
   * @param connection Database connection to use
   * @param bindValues Optional bind values for parameterized queries (PostgreSQL/SQLite only)
   */
  private async executeStatement(
    sql: string,
    page: number,
    pageSize: number,
    connection: DatabaseConnection,
    bindValues?: unknown[],
    cachedProvider?: DatabaseProvider,
  ): Promise<QueryResult> {
    const start = performance.now();
    const baseQuery = sql.replace(/;$/, "").trim();
    const queryType = detectQueryType(baseQuery);
    const providerConnectionId = connection.providerConnectionId;
    if (!providerConnectionId) {
      throw new Error("No connection established");
    }
    const provider = cachedProvider ?? (await this.providers.getForType(connection.type));
    const adapter = getAdapter(connection.type);

    // Handle utility/DDL statements (SET, PRAGMA, CREATE, ALTER, DROP, etc.)
    // These are not SELECT and not write queries — execute them without pagination.
    // Use select() (not execute()) so statements like SET properly modify connection state
    // in backends like DuckDB where conn.execute() may not apply settings.
    const isWrite = queryType === "insert" || queryType === "update" || queryType === "delete";
    if (queryType !== "select" && !isWrite) {
      await provider.select(providerConnectionId, baseQuery, bindValues);

      const totalMs = performance.now() - start;
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        totalRows: 0,
        executionTime: Math.round(totalMs * 100) / 100,
        queryType,
        page: 1,
        pageSize,
        totalPages: 1,
        isUtility: true,
      };
    }

    // Handle write queries (INSERT/UPDATE/DELETE)
    if (isWrite) {
      let rowsAffected = 0;
      let lastInsertId: number | undefined;

      const executeResult = await provider.execute(providerConnectionId, baseQuery, bindValues);
      rowsAffected = executeResult?.rowsAffected ?? 0;
      lastInsertId = executeResult?.lastInsertId;

      const totalMs = performance.now() - start;

      return {
        columns: ["Result"],
        rows: [{ Result: `${rowsAffected} row(s) affected` }],
        rowCount: 1,
        totalRows: 1,
        executionTime: Math.round(totalMs * 100) / 100,
        affectedRows: rowsAffected,
        lastInsertId,
        queryType,
        page: 1,
        pageSize: 1,
        totalPages: 1,
      };
    }

    // Handle SELECT queries
    // Check if query already has LIMIT/OFFSET clause - if so, skip pagination
    const hasLimit = /\bLIMIT\b/i.test(baseQuery);
    const hasOffset = /\bOFFSET\b/i.test(baseQuery);
    const hasTop = /\bTOP\b/i.test(baseQuery);
    const isMssql = connection.type === "mssql";
    const hasPagination = hasLimit || (isMssql && (hasOffset || hasTop));

    let totalRows = 0;
    let paginatedQuery = baseQuery;

    let dbResult: Record<string, unknown>[];

    if (hasPagination || pageSize === 0) {
      // Query has its own pagination or caller wants all rows — run as-is
      dbResult = await provider.select<Record<string, unknown>>(
        providerConnectionId,
        baseQuery,
        bindValues,
      );
      totalRows = dbResult?.length ?? 0;
    } else {
      // Optimistic pagination: fetch pageSize + 1 rows to detect whether more pages exist.
      // Only run an expensive COUNT query when the result fills the page.
      const offset = (page - 1) * pageSize;
      const probeLimit = pageSize + 1;

      paginatedQuery = adapter.paginateQuery(baseQuery, probeLimit, offset);

      dbResult = await provider.select<Record<string, unknown>>(
        providerConnectionId,
        paginatedQuery,
        bindValues,
      );

      if ((dbResult?.length ?? 0) <= pageSize) {
        // All results fit on this page — no COUNT needed
        totalRows = offset + (dbResult?.length ?? 0);
      } else {
        // More rows exist — trim the extra probe row and run COUNT
        dbResult = dbResult.slice(0, pageSize);
        const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) AS count_query`;
        try {
          const countResult = await provider.select<{ total: string | number }>(
            providerConnectionId,
            countQuery,
            bindValues,
          );
          totalRows = parseInt(String(countResult[0]?.total ?? "0"), 10);
        } catch {
          totalRows = offset + pageSize + 1;
        }
      }
    }

    const resultColumns = (dbResult?.length ?? 0) > 0 ? Object.keys(dbResult[0]) : [];
    const totalMs = performance.now() - start;

    const totalPages =
      hasPagination || pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

    // Try to extract source table info for CRUD operations
    const tableInfo = extractTableFromSelect(baseQuery);
    let sourceTable: QueryResult["sourceTable"] | undefined;

    if (tableInfo) {
      if (tableInfo.schema) {
        const primaryKeys = this.getPrimaryKeysForTable(tableInfo.schema, tableInfo.table);
        if (primaryKeys.length > 0) {
          sourceTable = {
            schema: tableInfo.schema,
            name: tableInfo.table,
            primaryKeys,
          };
        }
      } else {
        // No schema specified in query — search all cached schemas for the table
        const tables = this.state.schemas[this.state.activeConnectionId!] ?? [];
        const match = tables.find((t) => t.name === tableInfo.table);
        if (match) {
          const primaryKeys = match.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
          if (primaryKeys.length > 0) {
            sourceTable = {
              schema: match.schema,
              name: match.name,
              primaryKeys,
            };
          }
        }
      }
    }

    // Generate results
    return {
      columns: resultColumns,
      rows: dbResult || [],
      rowCount: dbResult?.length ?? 0,
      totalRows,
      executionTime: Math.round(totalMs * 100) / 100,
      queryType,
      sourceTable,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * Execute only the statement at the cursor position, with optional parameter substitution.
   */
  async executeCurrent(
    tabId: string,
    cursorOffset: number,
    page: number = 1,
    pageSize?: number,
    parameterValues?: ParameterValue[],
  ): Promise<void> {
    if (!this.state.activeProjectId) return;

    const connection = this.state.activeConnection;
    const isConnected = !!connection?.providerConnectionId;
    if (!connection || !isConnected) {
      errorToast("Not connected to database. Please reconnect.");
      return;
    }

    // Resolve the statement at cursor once (without params) to get the original SQL
    const baseResolved = resolveQuery(this.state, tabId, cursorOffset);
    if (!baseResolved) {
      toast.info(m.query_no_executable_statements());
      return;
    }

    const originalSql = baseResolved.query;
    const dbType = connection.type ?? "postgres";

    // Substitute parameters if provided
    let query = originalSql;
    let bindValues: unknown[] | undefined;
    if (parameterValues) {
      const substituted = substituteParameters(originalSql, parameterValues, dbType);
      query = substituted.sql;
      bindValues = substituted.bindValues;
    }

    // Mark as executing
    this.updateQueryTabState(tabId, { isExecuting: true });

    // Get effective page size
    const effectivePageSize =
      pageSize ?? baseResolved.tab.results?.[0]?.pageSize ?? this.DEFAULT_PAGE_SIZE;

    // Queue non-SELECT statements when pending changes is enabled
    if (this.pendingChanges.isEnabled() && !isSelectQuery(query)) {
      const origin: PendingChangeOrigin = "query-editor";
      this.pendingChanges.add(
        connection.id,
        query,
        detectQueryType(query),
        origin,
        tabId,
        bindValues,
      );
      this.updateQueryTabState(tabId, { isExecuting: false });
      toast.info("Statement added to pending changes");
      this.pendingChanges.openSheet();
      return;
    }

    try {
      const result = await this.executeStatement(
        query,
        page,
        effectivePageSize,
        connection,
        bindValues,
      );
      void log.info(
        `Query executed on ${connection.id}: ${result.rowCount} rows in ${result.executionTime}ms`,
      );
      const results: StatementResult[] = [
        {
          ...result,
          statementIndex: 0,
          statementSql: originalSql,
          isError: false,
        },
      ];

      this.updateQueryTabState(tabId, {
        results,
        activeResultIndex: 0,
        isExecuting: false,
      });

      // Add to history
      if (page === 1) {
        this.queryHistory.addToHistory(originalSql, results[0]);
      }
    } catch (error) {
      void log.error(`Query execution failed on ${connection.id}`);
      this.updateQueryTabState(tabId, {
        results: [this.createErrorResult(originalSql, error, 0)],
        activeResultIndex: 0,
        isExecuting: false,
      });
    }
  }

  /** @deprecated Use executeCurrent with parameterValues param */
  executeCurrentWithParams(
    tabId: string,
    cursorOffset: number,
    parameterValues: ParameterValue[],
    page?: number,
    pageSize?: number,
  ) {
    return this.executeCurrent(tabId, cursorOffset, page, pageSize, parameterValues);
  }

  /**
   * Execute all statements in a query tab, with optional parameter substitution.
   */
  async execute(
    tabId: string,
    page: number = 1,
    pageSize?: number,
    parameterValues?: ParameterValue[],
  ): Promise<void> {
    if (!this.state.activeProjectId) return;

    const connection = this.state.activeConnection;
    const isConnected = !!connection?.providerConnectionId;
    if (!connection || !isConnected) {
      errorToast("Not connected to database. Please reconnect.");
      return;
    }

    const tabs = this.state.queryTabsByProject[this.state.activeProjectId] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Mark as executing with proper reactivity
    this.updateQueryTabState(tabId, { isExecuting: true });

    // Get effective page size: use the first SELECT-type result's pageSize from previous execution, or default.
    // Avoid inheriting pageSize from error or utility results.
    const previousSelectResult = tab.results?.find(
      (r) => !r.isError && !r.isUtility && r.queryType === "select",
    );
    const effectivePageSize = pageSize ?? previousSelectResult?.pageSize ?? this.DEFAULT_PAGE_SIZE;

    // Get database type for parsing
    const dbType = connection.type ?? "postgres";

    // Parse SQL into individual statements
    const statements = splitSqlStatements(tab.query, dbType);

    // Handle case where all statements are comments
    if (statements.length === 0) {
      this.updateQueryTabState(tabId, {
        results: [],
        activeResultIndex: 0,
        isExecuting: false,
      });
      toast.info(m.query_no_executable_statements());
      return;
    }

    const allResults: StatementResult[] = [];
    let queuedCount = 0;
    const provider = await this.providers.getForType(connection.type);

    // Execute each statement, updating the UI incrementally
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        // Substitute parameters if provided
        let sql = stmt.sql;
        let bindValues: unknown[] | undefined;
        if (parameterValues) {
          const substituted = substituteParameters(stmt.sql, parameterValues, dbType);
          sql = substituted.sql;
          bindValues = substituted.bindValues;
        }

        // Queue write/DDL statements when pending changes is enabled
        if (this.pendingChanges.isEnabled() && !isSelectQuery(sql)) {
          const origin: PendingChangeOrigin = "query-editor";
          this.pendingChanges.add(
            connection.id,
            sql,
            detectQueryType(sql),
            origin,
            tabId,
            bindValues,
          );
          queuedCount++;
          continue;
        }

        const result = await this.executeStatement(
          sql,
          page,
          effectivePageSize,
          connection,
          bindValues,
          provider,
        );
        allResults.push({
          ...result,
          statementIndex: i,
          statementSql: stmt.sql, // Keep original SQL for display
          isError: false,
        });
      } catch (error) {
        // Continue on error - add error result
        allResults.push(this.createErrorResult(stmt.sql, error, i, effectivePageSize));
      }

      // Update UI incrementally after each statement completes
      this.updateQueryTabState(tabId, {
        results: [...allResults],
        activeResultIndex: 0,
      });
    }

    // Show toast for queued statements
    if (queuedCount > 0) {
      toast.info(`${queuedCount} statement${queuedCount > 1 ? "s" : ""} added to pending changes`);
      this.pendingChanges.openSheet();
    }

    // Log summary for all statements
    const totalTime = allResults.reduce((sum, r) => sum + (r.executionTime ?? 0), 0);
    const totalRows = allResults.reduce((sum, r) => sum + (r.isError ? 0 : r.rowCount), 0);
    const errorCount = allResults.filter((r) => r.isError).length;
    if (errorCount > 0) {
      void log.warn(
        `Query batch on ${connection.id}: ${allResults.length} statements, ${errorCount} failed, ${totalRows} rows in ${Math.round(totalTime * 100) / 100}ms`,
      );
    } else {
      void log.info(
        `Query batch on ${connection.id}: ${allResults.length} statements, ${totalRows} rows in ${Math.round(totalTime * 100) / 100}ms`,
      );
    }

    // Filter utility results and mark execution as complete
    const indexedResults = this.filterAndIndexResults(allResults);
    this.updateQueryTabState(tabId, {
      results: indexedResults,
      isExecuting: false,
    });

    // Add to history (only on first page to avoid duplicates, use first meaningful result)
    if (page === 1 && indexedResults.length > 0) {
      const historyResult = indexedResults.find((r) => !r.isUtility) ?? indexedResults[0];
      this.queryHistory.addToHistory(tab.query, historyResult);
    }
  }

  /** @deprecated Use execute with parameterValues param */
  executeWithParams(
    tabId: string,
    parameterValues: ParameterValue[],
    page?: number,
    pageSize?: number,
  ) {
    return this.execute(tabId, page, pageSize, parameterValues);
  }

  /**
   * Set the active result tab index.
   */
  setActiveResult(tabId: string, resultIndex: number): void {
    if (!this.state.activeProjectId) return;

    const tabs = this.state.queryTabsByProject[this.state.activeProjectId] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results || resultIndex < 0 || resultIndex >= tab.results.length) return;

    this.updateQueryTabState(tabId, { activeResultIndex: resultIndex });
  }

  /**
   * Navigate to a specific page for a specific result.
   */
  async goToPage(tabId: string, page: number, resultIndex?: number): Promise<void> {
    const tabs = this.state.queryTabsByProject[this.state.activeProjectId!] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results) return;

    const activeIndex = resultIndex ?? tab.activeResultIndex ?? 0;
    const result = tab.results[activeIndex];
    if (!result) return;

    const targetPage = Math.max(1, Math.min(page, result.totalPages));

    // Re-execute the specific statement with new page
    await this.executeStatementAtIndex(tabId, activeIndex, targetPage, result.pageSize);
  }

  /**
   * Re-execute a specific statement at a given index with pagination.
   */
  private async executeStatementAtIndex(
    tabId: string,
    resultIndex: number,
    page: number,
    pageSize: number,
  ): Promise<void> {
    if (!this.state.activeProjectId) return;

    const connection = this.state.activeConnection;
    const isConnected = !!connection?.providerConnectionId;
    if (!connection || !isConnected) return;

    const tabs = this.state.queryTabsByProject[this.state.activeProjectId] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results || resultIndex >= tab.results.length) return;

    const existingResult = tab.results[resultIndex];

    try {
      const result = await this.executeStatement(
        existingResult.statementSql,
        page,
        pageSize,
        connection,
      );

      // Update only this specific result in the array
      const newResults = [...tab.results];
      newResults[resultIndex] = {
        ...result,
        statementIndex: resultIndex,
        statementSql: existingResult.statementSql,
        isError: false,
      };

      this.updateQueryTabState(tabId, { results: newResults });
    } catch (error) {
      // Update with error
      const newResults = [...tab.results];
      newResults[resultIndex] = {
        ...existingResult,
        error: extractErrorMessage(error),
        isError: true,
      };
      this.updateQueryTabState(tabId, { results: newResults });
    }
  }

  /**
   * Set page size and re-execute query.
   */
  async setPageSize(tabId: string, pageSize: number, resultIndex?: number): Promise<void> {
    const tabs = this.state.queryTabsByProject[this.state.activeProjectId!] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results) return;

    const activeIndex = resultIndex ?? tab.activeResultIndex ?? 0;
    await this.executeStatementAtIndex(tabId, activeIndex, 1, pageSize);
  }

  /**
   * Update a cell value in the database (query tab version).
   * Resolves the row from tab results, then delegates to crud.updateCellDirect.
   */
  async updateCell(
    tabId: string,
    resultIndex: number,
    rowIndex: number,
    column: string,
    newValue: unknown,
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
  ): Promise<{ success: boolean; error?: string; queued?: boolean }> {
    const row = this.getRowFromTab(tabId, resultIndex, rowIndex);
    if (!row) return { success: false, error: "Row not found" };

    void log.debug(`Cell update on ${this.state.activeConnection?.id}`);
    const result = await this.crud.updateCellDirect(sourceTable, row, column, newValue);
    if (result.success) row[column] = newValue;
    return result;
  }

  /**
   * Set a cell value to its column DEFAULT (query tab version).
   * Resolves the row from tab results, then delegates to crud.setCellDefaultDirect.
   */
  async setCellDefault(
    tabId: string,
    resultIndex: number,
    rowIndex: number,
    column: string,
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
  ): Promise<{ success: boolean; error?: string; queued?: boolean }> {
    const row = this.getRowFromTab(tabId, resultIndex, rowIndex);
    if (!row) return { success: false, error: "Row not found" };

    void log.debug(`Cell set default on ${this.state.activeConnection?.id}`);
    const result = await this.crud.setCellDefaultDirect(sourceTable, row, column);
    if (result.success && !result.queued) {
      // Re-fetch the row to get the actual default value
      await this.execute(tabId);
    }
    return result;
  }

  // --- Delegated CRUD methods (preserve public API) ---

  insertRow(sourceTable: { schema: string; name: string }, values: Record<string, unknown>) {
    return this.crud.insertRow(sourceTable, values);
  }

  deleteRow(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
  ) {
    return this.crud.deleteRow(sourceTable, row);
  }

  updateCellDirect(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
    column: string,
    newValue: unknown,
  ) {
    return this.crud.updateCellDirect(sourceTable, row, column, newValue, {
      deduplicatePending: true,
    });
  }

  setCellDefaultDirect(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
    column: string,
  ) {
    return this.crud.setCellDefaultDirect(sourceTable, row, column, { deduplicatePending: true });
  }

  executeRaw(query: string) {
    return this.crud.executeRaw(query);
  }

  executeRawDdl(query: string) {
    return this.crud.executeRawDdl(query);
  }

  /**
   * Resolve a row from a query tab's results.
   */
  private getRowFromTab(
    tabId: string,
    resultIndex: number,
    rowIndex: number,
  ): Record<string, unknown> | undefined {
    const tabs = this.state.queryTabsByProject[this.state.activeProjectId!] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results || resultIndex >= tab.results.length) return undefined;
    return tab.results[resultIndex].rows[rowIndex];
  }
}
