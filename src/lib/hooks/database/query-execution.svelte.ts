import { toast } from "svelte-sonner";
import { errorToast } from "$lib/utils/toast";
import type { DatabaseConnection, QueryResult, StatementResult, ParameterValue } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { QueryHistoryManager } from "./query-history.svelte.js";
import {
  detectQueryType,
  isWriteQuery,
  isSelectQuery,
  extractTableFromSelect,
} from "$lib/db/query-utils";
import { splitSqlStatements, getStatementAtOffset } from "$lib/db/sql-parser";
import { substituteParameters } from "$lib/db/query-params";
import { m } from "$lib/paraglide/messages.js";
import type { ProviderRegistry } from "$lib/providers";
import { extractErrorMessage } from "$lib/errors";
import { log } from "$lib/utils/logger";

/**
 * Manages query execution, pagination, and CRUD operations.
 */
export class QueryExecutionManager {
  private readonly DEFAULT_PAGE_SIZE = 100;

  constructor(
    private state: DatabaseState,
    private queryHistory: QueryHistoryManager,
    private providers: ProviderRegistry,
  ) {}

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
    const tabs = this.state.queryTabsByProject[projectId] ?? [];
    const updatedTabs = tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab));

    this.state.queryTabsByProject = {
      ...this.state.queryTabsByProject,
      [projectId]: updatedTabs,
    };
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
   * Get a SQL placeholder with an explicit CAST if the column type requires it.
   * sqlx binds JS strings as PostgreSQL TEXT, which won't auto-cast to
   * timestamp, date, boolean, etc. This adds CAST($N AS <type>) when needed.
   */
  private getCastPlaceholder(
    paramIndex: number,
    schema: string,
    tableName: string,
    column: string,
  ): string {
    const placeholder = `$${paramIndex}`;
    const connectionId = this.state.activeConnectionId;
    if (!connectionId) return placeholder;

    const tables = this.state.schemas[connectionId] ?? [];
    const table = tables.find((t) => t.name === tableName && t.schema === schema);
    if (!table) return placeholder;

    const col = table.columns.find((c) => c.name === column);
    if (!col) return placeholder;

    const colType = col.type.toLowerCase();
    // Text types don't need casting — the bind value is already TEXT
    const textTypes = ["text", "character varying", "character"];
    // Types we can't reliably cast to (enums, arrays, composite)
    const skipTypes = ["user-defined", "array"];

    if (textTypes.includes(colType) || skipTypes.includes(colType)) {
      return placeholder;
    }

    return `CAST(${placeholder} AS ${col.type})`;
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
  ): Promise<QueryResult> {
    const start = performance.now();
    const baseQuery = sql.replace(/;$/, "").trim();
    const queryType = detectQueryType(baseQuery);
    const providerConnectionId = connection.providerConnectionId;
    if (!providerConnectionId) {
      throw new Error("No connection established");
    }
    const provider = await this.providers.getForType(connection.type);
    const isMssql = connection.type === "mssql";

    // Handle utility/DDL statements (SET, PRAGMA, CREATE, ALTER, DROP, etc.)
    // These are not SELECT and not write queries — execute them without pagination.
    // Use select() (not execute()) so statements like SET properly modify connection state
    // in backends like DuckDB where conn.execute() may not apply settings.
    if (!isSelectQuery(baseQuery) && !isWriteQuery(baseQuery)) {
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
    if (isWriteQuery(baseQuery)) {
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
    const hasPagination = hasLimit || (isMssql && (hasOffset || hasTop));

    let totalRows = 0;
    let paginatedQuery = baseQuery;

    if (!hasPagination) {
      // Get total count first by wrapping in a subquery
      const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) AS count_query`;
      try {
        const countResult = await provider.select<{ total: string | number }>(
          providerConnectionId,
          countQuery,
          bindValues,
        );
        totalRows = parseInt(String(countResult[0]?.total ?? "0"), 10);
      } catch {
        // If count fails, just run the query without pagination
        totalRows = -1;
      }

      // Add pagination if we successfully got a count (it's a SELECT)
      // pageSize === 0 means "all rows" — skip LIMIT/OFFSET
      if (totalRows >= 0 && pageSize > 0) {
        const offset = (page - 1) * pageSize;
        if (isMssql) {
          // SQL Server uses OFFSET FETCH syntax (requires ORDER BY)
          if (!/\bORDER\s+BY\b/i.test(baseQuery)) {
            paginatedQuery = `${baseQuery} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
          } else {
            paginatedQuery = `${baseQuery} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
          }
        } else {
          paginatedQuery = `${baseQuery} LIMIT ${pageSize} OFFSET ${offset}`;
        }
      }
    } else {
      // Query has its own pagination, don't add more
      totalRows = -1;
    }

    const dbResult = await provider.select<Record<string, unknown>>(
      providerConnectionId,
      paginatedQuery,
      bindValues,
    );
    const resultColumns = (dbResult?.length ?? 0) > 0 ? Object.keys(dbResult[0]) : [];
    const totalMs = performance.now() - start;

    // If count failed or query had LIMIT, use result length as total
    if (totalRows < 0) {
      totalRows = dbResult?.length ?? 0;
    }

    const totalPages =
      hasPagination || pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

    // Try to extract source table info for CRUD operations
    const tableInfo = extractTableFromSelect(baseQuery);
    let sourceTable: QueryResult["sourceTable"] | undefined;

    if (tableInfo) {
      const defaultSchema = isMssql ? "dbo" : "public";
      const schema = tableInfo.schema || defaultSchema;
      const primaryKeys = this.getPrimaryKeysForTable(schema, tableInfo.table);
      if (primaryKeys.length > 0) {
        sourceTable = {
          schema,
          name: tableInfo.table,
          primaryKeys,
        };
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
   * Execute only the statement at the cursor position.
   */
  async executeCurrent(
    tabId: string,
    cursorOffset: number,
    page: number = 1,
    pageSize?: number,
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

    // Get database type for parsing
    const dbType = connection.type ?? "postgres";

    // Get the statement at cursor position
    const statement = getStatementAtOffset(tab.query, cursorOffset, dbType);
    if (!statement) {
      toast.info(m.query_no_executable_statements());
      return;
    }

    // Mark as executing
    this.updateQueryTabState(tabId, { isExecuting: true });

    // Get effective page size
    const effectivePageSize = pageSize ?? tab.results?.[0]?.pageSize ?? this.DEFAULT_PAGE_SIZE;

    try {
      const result = await this.executeStatement(
        statement.sql,
        page,
        effectivePageSize,
        connection,
      );
      void log.info(
        `Query executed on ${connection.id}: ${result.rowCount} rows in ${result.executionTime}ms`,
      );
      const results: StatementResult[] = [
        {
          ...result,
          statementIndex: 0,
          statementSql: statement.sql,
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
        this.queryHistory.addToHistory(statement.sql, results[0]);
      }
    } catch (error) {
      void log.error(`Query execution failed on ${connection.id}`);
      const results: StatementResult[] = [
        {
          columns: ["Error"],
          rows: [{ Error: extractErrorMessage(error) }],
          rowCount: 1,
          totalRows: 1,
          executionTime: 0,
          page: 1,
          pageSize: 1,
          totalPages: 1,
          statementIndex: 0,
          statementSql: statement.sql,
          error: extractErrorMessage(error),
          isError: true,
        },
      ];

      this.updateQueryTabState(tabId, {
        results,
        activeResultIndex: 0,
        isExecuting: false,
      });
    }
  }

  /**
   * Execute only the statement at cursor position with parameters.
   */
  async executeCurrentWithParams(
    tabId: string,
    cursorOffset: number,
    parameterValues: ParameterValue[],
    page: number = 1,
    pageSize?: number,
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

    // Get database type for parsing
    const dbType = connection.type ?? "postgres";

    // Get the statement at cursor position
    const statement = getStatementAtOffset(tab.query, cursorOffset, dbType);
    if (!statement) {
      toast.info(m.query_no_executable_statements());
      return;
    }

    // Mark as executing
    this.updateQueryTabState(tabId, { isExecuting: true });

    // Get effective page size
    const effectivePageSize = pageSize ?? tab.results?.[0]?.pageSize ?? this.DEFAULT_PAGE_SIZE;

    try {
      // Substitute parameters
      const { sql, bindValues } = substituteParameters(statement.sql, parameterValues, dbType);

      const result = await this.executeStatement(
        sql,
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
          statementSql: statement.sql, // Keep original SQL for display
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
        this.queryHistory.addToHistory(statement.sql, results[0]);
      }
    } catch (error) {
      void log.error(`Query execution failed on ${connection.id}`);
      const results: StatementResult[] = [
        {
          columns: ["Error"],
          rows: [{ Error: extractErrorMessage(error) }],
          rowCount: 1,
          totalRows: 1,
          executionTime: 0,
          page: 1,
          pageSize: 1,
          totalPages: 1,
          statementIndex: 0,
          statementSql: statement.sql,
          error: extractErrorMessage(error),
          isError: true,
        },
      ];

      this.updateQueryTabState(tabId, {
        results,
        activeResultIndex: 0,
        isExecuting: false,
      });
    }
  }

  /**
   * Execute all statements in a query tab.
   */
  async execute(tabId: string, page: number = 1, pageSize?: number): Promise<void> {
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

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        const result = await this.executeStatement(stmt.sql, page, effectivePageSize, connection);
        allResults.push({
          ...result,
          statementIndex: i,
          statementSql: stmt.sql,
          isError: false,
        });
      } catch (error) {
        // Continue on error - add error result
        allResults.push({
          columns: ["Error"],
          rows: [{ Error: extractErrorMessage(error) }],
          rowCount: 1,
          totalRows: 1,
          executionTime: 0,
          page: 1,
          pageSize: effectivePageSize,
          totalPages: 1,
          statementIndex: i,
          statementSql: stmt.sql,
          error: extractErrorMessage(error),
          isError: true,
        });
      }
    }

    // Filter out utility results (SET, PRAGMA, etc.) — they executed but don't need result tabs.
    // Keep them only if ALL statements are utility (so the user sees something).
    const displayResults = allResults.filter((r) => !r.isUtility);
    const results = displayResults.length > 0 ? displayResults : allResults;

    // Re-index displayed results
    const indexedResults = results.map((r, idx) => ({ ...r, statementIndex: idx }));

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

    // Update tab with filtered results
    this.updateQueryTabState(tabId, {
      results: indexedResults,
      activeResultIndex: 0,
      isExecuting: false,
    });

    // Add to history (only on first page to avoid duplicates, use first meaningful result)
    if (page === 1 && indexedResults.length > 0) {
      const historyResult = indexedResults.find((r) => !r.isUtility) ?? indexedResults[0];
      this.queryHistory.addToHistory(tab.query, historyResult);
    }
  }

  /**
   * Execute a parameterized query with user-provided values.
   * Substitutes {{param}} placeholders with values before execution.
   */
  async executeWithParams(
    tabId: string,
    parameterValues: ParameterValue[],
    page: number = 1,
    pageSize?: number,
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

    // Mark as executing
    this.updateQueryTabState(tabId, { isExecuting: true });

    // Get effective page size: use the first SELECT-type result's pageSize from previous execution, or default.
    const previousSelectResult = tab.results?.find(
      (r) => !r.isError && !r.isUtility && r.queryType === "select",
    );
    const effectivePageSize = pageSize ?? previousSelectResult?.pageSize ?? this.DEFAULT_PAGE_SIZE;

    // Get database type
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

    // Execute each statement with parameter substitution
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        // Substitute parameters for this statement
        const { sql, bindValues } = substituteParameters(stmt.sql, parameterValues, dbType);

        const result = await this.executeStatement(
          sql,
          page,
          effectivePageSize,
          connection,
          bindValues,
        );
        allResults.push({
          ...result,
          statementIndex: i,
          statementSql: stmt.sql, // Keep original SQL with {{}} for display
          isError: false,
        });
      } catch (error) {
        allResults.push({
          columns: ["Error"],
          rows: [{ Error: extractErrorMessage(error) }],
          rowCount: 1,
          totalRows: 1,
          executionTime: 0,
          page: 1,
          pageSize: effectivePageSize,
          totalPages: 1,
          statementIndex: i,
          statementSql: stmt.sql,
          error: extractErrorMessage(error),
          isError: true,
        });
      }
    }

    // Log summary for all statements
    const totalTimeP = allResults.reduce((sum, r) => sum + (r.executionTime ?? 0), 0);
    const totalRowsP = allResults.reduce((sum, r) => sum + (r.isError ? 0 : r.rowCount), 0);
    const errorCountP = allResults.filter((r) => r.isError).length;
    if (errorCountP > 0) {
      void log.warn(
        `Query batch on ${connection.id}: ${allResults.length} statements, ${errorCountP} failed, ${totalRowsP} rows in ${Math.round(totalTimeP * 100) / 100}ms`,
      );
    } else {
      void log.info(
        `Query batch on ${connection.id}: ${allResults.length} statements, ${totalRowsP} rows in ${Math.round(totalTimeP * 100) / 100}ms`,
      );
    }

    // Filter out utility results (SET, PRAGMA, etc.)
    const displayResults = allResults.filter((r) => !r.isUtility);
    const results = displayResults.length > 0 ? displayResults : allResults;

    // Re-index displayed results
    const indexedResults = results.map((r, idx) => ({ ...r, statementIndex: idx }));

    // Update tab with filtered results
    this.updateQueryTabState(tabId, {
      results: indexedResults,
      activeResultIndex: 0,
      isExecuting: false,
    });

    // Add to history (only on first page, use first meaningful result)
    if (page === 1 && indexedResults.length > 0) {
      const historyResult = indexedResults.find((r) => !r.isUtility) ?? indexedResults[0];
      this.queryHistory.addToHistory(tab.query, historyResult);
    }
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
   * Update a cell value in the database.
   */
  async updateCell(
    tabId: string,
    resultIndex: number,
    rowIndex: number,
    column: string,
    newValue: unknown,
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
  ): Promise<{ success: boolean; error?: string }> {
    const tabs = this.state.queryTabsByProject[this.state.activeProjectId!] ?? [];
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab?.results || resultIndex >= tab.results.length) {
      return { success: false, error: "No results" };
    }

    const result = tab.results[resultIndex];
    const row = result.rows[rowIndex];
    if (!row) return { success: false, error: "Row not found" };

    if (sourceTable.primaryKeys.length === 0) {
      return { success: false, error: "No primary key found" };
    }

    const connection = this.state.activeConnection;
    if (!connection?.providerConnectionId) {
      return { success: false, error: "No connection established" };
    }

    void log.debug(`Cell update on ${connection?.id}`);
    try {
      const provider = await this.providers.getForType(connection.type);
      if (connection.type === "mssql") {
        // SQL Server: use square brackets for identifiers and inline values
        const whereConditions = sourceTable.primaryKeys.map((pk) => {
          const val = row[pk];
          const escapedVal = typeof val === "string" ? `'${val.replace(/'/g, "''")}'` : String(val);
          return `[${pk}] = ${escapedVal}`;
        });
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const escapedNewValue =
          typeof newValue === "string"
            ? `'${newValue.replace(/'/g, "''")}'`
            : newValue === null
              ? "NULL"
              : // oxlint-disable-next-line typescript-eslint(no-base-to-string)
                String(newValue);
        const query = `UPDATE [${sourceTable.schema}].[${sourceTable.name}] SET [${column}] = ${escapedNewValue} WHERE ${whereConditions.join(" AND ")}`;
        await provider.execute(connection.providerConnectionId, query);
      } else {
        // PostgreSQL/SQLite/DuckDB: use double quotes and parameterized queries
        const whereConditions = sourceTable.primaryKeys.map((pk, i) => `"${pk}" = $${i + 2}`);
        // Look up column type for explicit CAST — sqlx binds strings as TEXT,
        // and PostgreSQL won't implicitly cast TEXT to timestamp, date, etc.
        const valuePlaceholder = this.getCastPlaceholder(
          1,
          sourceTable.schema,
          sourceTable.name,
          column,
        );
        const query = `UPDATE "${sourceTable.schema}"."${sourceTable.name}" SET "${column}" = ${valuePlaceholder} WHERE ${whereConditions.join(" AND ")}`;
        const bindValues = [newValue, ...sourceTable.primaryKeys.map((pk) => row[pk])];
        await provider.execute(connection.providerConnectionId, query, bindValues);
      }
      // Update the local row data
      row[column] = newValue;
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
  ): Promise<{ success: boolean; error?: string; lastInsertId?: number }> {
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
      if (connection.type === "mssql") {
        // SQL Server: use square brackets for identifiers and inline values
        const columnNames = columns.map((c) => `[${c}]`).join(", ");
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const valuesList = Object.values(values)
          .map((v) => {
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
            return v;
          })
          .join(", ");
        const query = `INSERT INTO [${sourceTable.schema}].[${sourceTable.name}] (${columnNames}) VALUES (${valuesList})`;
        await provider.execute(connection.providerConnectionId, query);
        return { success: true };
      } else {
        // PostgreSQL/SQLite/DuckDB: use double quotes and parameterized queries
        const columnNames = columns.map((c) => `"${c}"`).join(", ");
        const placeholders = columns
          .map((col, i) =>
            this.getCastPlaceholder(i + 1, sourceTable.schema, sourceTable.name, col),
          )
          .join(", ");
        const query = `INSERT INTO "${sourceTable.schema}"."${sourceTable.name}" (${columnNames}) VALUES (${placeholders})`;
        const result = await provider.execute(
          connection.providerConnectionId,
          query,
          Object.values(values),
        );
        return { success: true, lastInsertId: result?.lastInsertId };
      }
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
   * Delete a row from the database.
   */
  async deleteRow(
    sourceTable: { schema: string; name: string; primaryKeys: string[] },
    row: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
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
      if (connection.type === "mssql") {
        // SQL Server: use square brackets for identifiers and inline values
        const whereConditions = sourceTable.primaryKeys.map((pk) => {
          const val = row[pk];
          const escapedVal = typeof val === "string" ? `'${val.replace(/'/g, "''")}'` : String(val);
          return `[${pk}] = ${escapedVal}`;
        });
        const query = `DELETE FROM [${sourceTable.schema}].[${sourceTable.name}] WHERE ${whereConditions.join(" AND ")}`;
        await provider.execute(connection.providerConnectionId, query);
      } else {
        // PostgreSQL/SQLite/DuckDB: use double quotes and parameterized queries
        const whereConditions = sourceTable.primaryKeys.map((pk, i) => `"${pk}" = $${i + 1}`);
        const query = `DELETE FROM "${sourceTable.schema}"."${sourceTable.name}" WHERE ${whereConditions.join(" AND ")}`;
        const bindValues = sourceTable.primaryKeys.map((pk) => row[pk]);
        await provider.execute(connection.providerConnectionId, query, bindValues);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }
}
