import type { DatabaseAdapter } from "./index";
import { validateIdentifier } from "./index";
import type { ExplainPlanNode, ExplainResult } from "$lib/types";
import { makeNodeIdFactory } from "./explain-helpers";
import {
  generateAlterTableSql,
  buildColumnType,
  generateAddColumnDdl,
  sanitizeDefaultValue,
} from "./alter-table";
import type { SqlWithBindings, CastLookup } from "./crud-helpers";
import {
  buildParamUpdate,
  buildParamSetDefault,
  buildParamInsert,
  buildParamDelete,
} from "./crud-helpers";
import type {
  SchemaTable,
  SchemaColumn,
  SchemaIndex,
  ForeignKeyRef,
  TableSizeInfo,
  IndexUsageInfo,
  DatabaseOverview,
  ColumnTypeInfo,
  CreateTableDefinition,
  CreateTableColumn,
} from "$lib/types";

interface SqliteSchemaRow {
  name: string;
  type: string;
}

interface SqliteColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteIndexRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SqliteForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export class SqliteAdapter implements DatabaseAdapter {
  getSchemaQuery(): string {
    return `SELECT name, type FROM sqlite_master
			WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
			ORDER BY name`;
  }

  getColumnsQuery(table: string, _schema: string): string {
    // SQLite uses PRAGMA for table info
    return `PRAGMA table_info('${validateIdentifier(table)}')`;
  }

  getIndexesQuery(table: string, _schema: string): string {
    return `PRAGMA index_list('${validateIdentifier(table)}')`;
  }

  getForeignKeysQuery(table: string, _schema: string): string {
    return `PRAGMA foreign_key_list('${validateIdentifier(table)}')`;
  }

  getExplainQuery(query: string, _analyze: boolean): string {
    // SQLite doesn't support ANALYZE in the same way as PostgreSQL
    // EXPLAIN QUERY PLAN shows the query plan without execution
    const baseQuery = query.replace(/;$/, "");
    return `EXPLAIN QUERY PLAN ${baseQuery}`;
  }

  parseExplainResult(rows: unknown[], analyze: boolean): ExplainResult {
    // SQLite EXPLAIN QUERY PLAN returns: id, parent, notused, detail
    const result = rows as {
      id: number;
      parent: number;
      detail: string;
    }[];

    const nextId = makeNodeIdFactory();

    if (result.length === 0) {
      return {
        plan: { id: nextId(), nodeType: "Query Plan", children: [] },
        planningTime: 0,
        executionTime: undefined,
        isAnalyze: analyze,
      };
    }

    // Build ExplainPlanNodes keyed by SQLite row id, remembering parent ids.
    interface Entry {
      node: ExplainPlanNode;
      sqliteId: number;
      parentSqliteId: number;
    }
    const entries: Entry[] = result.map((row) => ({
      node: this.parseSqliteDetail(row.detail, nextId),
      sqliteId: row.id,
      parentSqliteId: row.parent,
    }));

    const byId = new Map<number, Entry>();
    for (const e of entries) byId.set(e.sqliteId, e);

    // Wire children in source order (SQLite already emits rows in execution order).
    const roots: ExplainPlanNode[] = [];
    for (const e of entries) {
      if (e.parentSqliteId === 0 || !byId.has(e.parentSqliteId)) {
        roots.push(e.node);
      } else {
        byId.get(e.parentSqliteId)!.node.children.push(e.node);
      }
    }

    const plan = this.wrapSqliteRoots(roots, nextId);

    return {
      plan,
      planningTime: 0,
      executionTime: undefined,
      isAnalyze: analyze,
    };
  }

  /**
   * Choose a synthetic root when SQLite emits multiple `parent=0` rows.
   *
   * SQLite's EQP output intermixes setup operations (MATERIALIZE, CO-ROUTINE)
   * with the actual scan-loop at the top level — they all share `parent=0`.
   * Only consecutive scan-like nodes at the top form a nested-loop join; the
   * rest are prep steps. We detect the pure-scan-loop case and label it
   * "Nested Loop"; mixed or non-scan top levels get a neutral "Query Plan"
   * wrapper so we don't imply a join that isn't there.
   */
  private wrapSqliteRoots(roots: ExplainPlanNode[], nextId: () => string): ExplainPlanNode {
    if (roots.length === 1) return roots[0]!;

    const isScanLike = (n: ExplainPlanNode) =>
      n.nodeType === "Seq Scan" || n.nodeType === "Index Scan" || n.nodeType === "Index Only Scan";

    const allScans = roots.length >= 2 && roots.every(isScanLike);
    const nodeType = allScans ? "Nested Loop" : "Query Plan";
    return { id: nextId(), nodeType, children: roots };
  }

  /**
   * Parse a single SQLite EXPLAIN QUERY PLAN `detail` string into structured fields.
   * SQLite documents the grammar informally — see https://www.sqlite.org/eqp.html.
   *
   * All patterns covered below are attested in those docs; order matters because
   * some patterns are prefixes of others (e.g. SEARCH ... USING INDEX vs SEARCH
   * ... USING AUTOMATIC COVERING INDEX).
   */
  private parseSqliteDetail(detail: string, nextId: () => string): ExplainPlanNode {
    const base = (): ExplainPlanNode => ({ id: nextId(), nodeType: "Step", children: [] });

    // SCAN <table> [AS <alias>] [USING (COVERING )?INDEX <idx>]
    const scan = /^SCAN (\w+)(?: AS (\w+))?(?: USING (COVERING )?INDEX (\w+))?$/.exec(detail);
    if (scan) {
      const [, table, alias, covering, idx] = scan;
      const node = base();
      node.nodeType = idx ? (covering ? "Index Only Scan" : "Index Scan") : "Seq Scan";
      node.relationName = table;
      if (alias && alias !== table) node.alias = alias;
      if (idx) node.indexName = idx;
      return node;
    }

    // SEARCH <table> [AS <alias>] USING AUTOMATIC (COVERING )?INDEX [(<cond>)]
    // Automatic indexes are built at query time and have no name.
    const searchAuto =
      /^SEARCH (\w+)(?: AS (\w+))? USING AUTOMATIC (COVERING )?INDEX(?: \((.+)\))?$/.exec(detail);
    if (searchAuto) {
      const [, table, alias, covering, cond] = searchAuto;
      const node = base();
      node.nodeType = covering ? "Index Only Scan" : "Index Scan";
      node.relationName = table;
      if (alias && alias !== table) node.alias = alias;
      node.indexName = "<automatic>";
      if (cond) node.indexCond = cond;
      return node;
    }

    // SEARCH <table> [AS <alias>] USING (COVERING )?INDEX <index> [(<cond>)]
    const searchIndex =
      /^SEARCH (\w+)(?: AS (\w+))? USING (COVERING )?INDEX (\w+)(?: \((.+)\))?$/.exec(detail);
    if (searchIndex) {
      const [, table, alias, covering, index, cond] = searchIndex;
      const node = base();
      node.nodeType = covering ? "Index Only Scan" : "Index Scan";
      node.relationName = table;
      if (alias && alias !== table) node.alias = alias;
      node.indexName = index;
      if (cond) node.indexCond = cond;
      return node;
    }

    // SEARCH <table> [AS <alias>] USING (INTEGER )?PRIMARY KEY [(<cond>)]
    const searchPk =
      /^SEARCH (\w+)(?: AS (\w+))? USING (?:INTEGER )?PRIMARY KEY(?: \((.+)\))?$/.exec(detail);
    if (searchPk) {
      const [, table, alias, cond] = searchPk;
      const node = base();
      node.nodeType = "Index Scan";
      node.relationName = table;
      if (alias && alias !== table) node.alias = alias;
      node.indexName = "PRIMARY KEY";
      if (cond) node.indexCond = cond;
      return node;
    }

    // USE TEMP B-TREE FOR ORDER BY | GROUP BY | DISTINCT | RIGHT PART OF ORDER BY
    const tempBtree =
      /^USE TEMP B-TREE FOR (ORDER BY|GROUP BY|DISTINCT|RIGHT PART OF ORDER BY|LEFT PART OF ORDER BY)$/.exec(
        detail,
      );
    if (tempBtree) {
      const node = base();
      const kind = tempBtree[1]!;
      node.nodeType = kind === "GROUP BY" ? "Group" : kind === "DISTINCT" ? "Distinct" : "Sort";
      return node;
    }

    // MATERIALIZE <alias> — subquery materialized into a transient table.
    // The alias is meaningful because the outer query references it via `SCAN <alias>`.
    const materialize = /^MATERIALIZE (\w+)$/.exec(detail) ?? /^MATERIALIZE$/.exec(detail);
    if (materialize) {
      const node = base();
      node.nodeType = "Materialize";
      if (materialize[1]) node.relationName = materialize[1];
      return node;
    }

    // CO-ROUTINE <alias> — subquery executed as a co-routine, same alias semantics.
    const coroutine = /^CO-ROUTINE (\w+)$/.exec(detail) ?? /^CO-ROUTINE$/.exec(detail);
    if (coroutine) {
      const node = base();
      node.nodeType = "Subquery";
      if (coroutine[1]) node.relationName = coroutine[1];
      return node;
    }

    // (CORRELATED )?SCALAR SUBQUERY
    if (detail === "SCALAR SUBQUERY" || detail === "CORRELATED SCALAR SUBQUERY") {
      const node = base();
      node.nodeType = detail.startsWith("CORRELATED") ? "Correlated Subquery" : "Subquery";
      return node;
    }

    // MULTI-INDEX OR — an OR'd predicate resolved by scanning multiple indexes and unioning.
    if (detail === "MULTI-INDEX OR") {
      const node = base();
      node.nodeType = "BitmapOr";
      return node;
    }

    // MERGE (UNION|INTERSECT|EXCEPT) — compound-select merge without a temp b-tree.
    const merge = /^MERGE \((UNION( ALL)?|INTERSECT|EXCEPT)\)$/.exec(detail);
    if (merge) {
      const node = base();
      // Fold the operator kind into the nodeType so the chip reads e.g. "Merge (UNION ALL)".
      node.nodeType = `Merge (${merge[1]!})`;
      return node;
    }

    // LEFT / RIGHT — wrappers that appear as children of MERGE.
    if (detail === "LEFT" || detail === "RIGHT") {
      const node = base();
      node.nodeType = detail === "LEFT" ? "Left Input" : "Right Input";
      return node;
    }

    // COMPOUND QUERY / LEFT-MOST SUBQUERY — compound-SELECT structure.
    if (detail.startsWith("COMPOUND QUERY")) {
      const node = base();
      node.nodeType = "Compound";
      return node;
    }
    if (detail === "LEFT-MOST SUBQUERY") {
      const node = base();
      node.nodeType = "Subquery";
      return node;
    }

    // UNION / UNION ALL / EXCEPT / INTERSECT, optionally followed by USING TEMP B-TREE.
    const compound = /^(UNION ALL|UNION|EXCEPT|INTERSECT)(?: USING TEMP B-TREE)?$/.exec(detail);
    if (compound) {
      const kind = compound[1]!;
      const node = base();
      node.nodeType =
        kind === "UNION ALL"
          ? "Union All"
          : kind === "UNION"
            ? "Union"
            : kind === "EXCEPT"
              ? "Except"
              : "Intersect";
      return node;
    }

    // Fallback — unknown pattern. We deliberately don't stuff the raw detail
    // into `filter`/`indexCond`/`sortKey` because those imply structure the
    // engine hasn't confirmed. Unknown patterns surface as a chip with the
    // first word as nodeType; if this turns out to matter we add a regex above.
    const node = base();
    node.nodeType = detail.split(" ")[0] ?? "Step";
    return node;
  }

  parseSchemaResult(rows: unknown[]): SchemaTable[] {
    return (rows as SqliteSchemaRow[]).map((row) => ({
      name: row.name,
      schema: "main", // SQLite uses "main" as the default schema
      type: row.type === "view" ? "view" : "table",
      columns: [],
      indexes: [],
    }));
  }

  parseColumnsResult(rows: unknown[], foreignKeys?: unknown[]): SchemaColumn[] {
    const fkMap = new Map<string, ForeignKeyRef>();
    if (foreignKeys) {
      for (const fk of foreignKeys as SqliteForeignKeyRow[]) {
        fkMap.set(fk.from, {
          referencedSchema: "main", // SQLite uses "main" as default schema
          referencedTable: fk.table,
          referencedColumn: fk.to,
        });
      }
    }

    return (rows as SqliteColumnRow[]).map((col) => ({
      name: col.name,
      type: col.type || "BLOB", // SQLite allows empty type
      nullable: col.notnull === 0,
      defaultValue: col.dflt_value || undefined,
      isPrimaryKey: col.pk > 0,
      isForeignKey: fkMap.has(col.name),
      foreignKeyRef: fkMap.get(col.name),
    }));
  }

  parseIndexesResult(rows: unknown[]): SchemaIndex[] {
    return (rows as SqliteIndexRow[])
      .filter((idx) => idx.name && !idx.name.startsWith("sqlite_"))
      .map((idx) => ({
        name: idx.name,
        columns: [], // Would need separate PRAGMA index_info call for columns
        unique: idx.unique === 1,
        type: "btree",
      }));
  }

  // === STATISTICS METHODS ===
  // Note: SQLite has limited statistics compared to PostgreSQL

  getTableSizesQuery(): string {
    // SQLite doesn't track individual table sizes easily
    // We get table names first, then row counts are fetched separately
    return `SELECT
			name AS table_name,
			'main' AS schema_name
		FROM sqlite_master
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
		ORDER BY name`;
  }

  getTableRowCountQuery(table: string, _schema: string): string {
    return `SELECT COUNT(*) AS row_count FROM "${validateIdentifier(table)}"`;
  }

  getIndexUsageQuery(): string {
    // SQLite doesn't track index usage statistics
    // Return indexes from sqlite_master
    return `SELECT
			m.name AS index_name,
			m.tbl_name AS table_name,
			'main' AS schema_name
		FROM sqlite_master m
		WHERE m.type = 'index' AND m.name NOT LIKE 'sqlite_%'
		ORDER BY m.tbl_name, m.name`;
  }

  getDatabaseOverviewQuery(): string {
    // Get basic database info using PRAGMA
    return `SELECT
			(SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%') AS table_count,
			(SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%') AS index_count,
			(SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) AS total_size_bytes`;
  }

  parseTableSizesResult(rows: unknown[]): TableSizeInfo[] {
    // SQLite doesn't provide detailed size info per table
    return (rows as { table_name: string; schema_name: string }[]).map((row) => ({
      schema: row.schema_name || "main",
      name: row.table_name,
      rowCount: 0, // Would need separate COUNT(*) queries
      totalSize: "N/A",
      totalSizeBytes: 0,
    }));
  }

  parseIndexUsageResult(rows: unknown[]): IndexUsageInfo[] {
    // SQLite doesn't track index usage
    return (rows as { index_name: string; table_name: string; schema_name: string }[]).map(
      (row) => ({
        schema: row.schema_name || "main",
        table: row.table_name,
        indexName: row.index_name,
        size: "N/A",
        scans: 0,
        unused: false, // Unknown
      }),
    );
  }

  parseDatabaseOverviewResult(rows: unknown[]): DatabaseOverview {
    const row = (
      rows as { table_count: number; index_count: number; total_size_bytes: number }[]
    )[0];
    const sizeBytes = Number(row?.total_size_bytes) || 0;
    return {
      databaseName: "SQLite Database",
      totalSize: this.formatBytes(sizeBytes),
      totalSizeBytes: sizeBytes,
      tableCount: Number(row?.table_count) || 0,
      indexCount: Number(row?.index_count) || 0,
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 bytes";
    const k = 1024;
    const sizes = ["bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // === CREATE TABLE METHODS ===

  getColumnTypes(): ColumnTypeInfo[] {
    return [
      // String
      { name: "TEXT", category: "String" },
      { name: "VARCHAR", category: "String", hasLength: true },
      // Numeric
      { name: "INTEGER", category: "Numeric" },
      { name: "REAL", category: "Numeric" },
      { name: "NUMERIC", category: "Numeric", hasPrecision: true },
      // Binary
      { name: "BLOB", category: "Binary" },
      // Boolean
      { name: "BOOLEAN", category: "Boolean" },
      // Date/Time
      { name: "DATE", category: "Date/Time" },
      { name: "DATETIME", category: "Date/Time" },
      { name: "TIMESTAMP", category: "Date/Time" },
    ];
  }

  private static readonly quote = (n: string) => `"${n}"`;

  generateCreateTableSql(definition: CreateTableDefinition): string {
    const { tableName, columns, indexes, foreignKeys } = definition;
    const q = SqliteAdapter.quote;
    const lines: string[] = [];

    for (const col of columns) {
      let line = `  ${q(col.name)} ${buildColumnType(col)}`;
      if (col.isPrimaryKey && columns.filter((c) => c.isPrimaryKey).length === 1) {
        line += " PRIMARY KEY";
        if (col.type.toUpperCase() === "INTEGER") line += " AUTOINCREMENT";
      }
      if (!col.nullable) line += " NOT NULL";
      if (col.defaultValue) {
        const safe = sanitizeDefaultValue(col.defaultValue);
        if (safe) line += ` DEFAULT ${safe}`;
      }
      if (col.isUnique && !col.isPrimaryKey) line += " UNIQUE";
      lines.push(line);
    }

    const pkCols = columns.filter((c) => c.isPrimaryKey);
    if (pkCols.length > 1) {
      lines.push(`  PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(", ")})`);
    }

    for (const fk of foreignKeys) {
      lines.push(
        `  FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.referencedTable)} (${q(fk.referencedColumn)})`,
      );
    }

    let sql = `CREATE TABLE ${q(tableName)} (\n${lines.join(",\n")}\n);`;

    for (const idx of indexes) {
      const unique = idx.unique ? "UNIQUE " : "";
      const cols = idx.columns.map((c) => q(c)).join(", ");
      sql += `\n\nCREATE ${unique}INDEX ${q(idx.name)} ON ${q(tableName)} (${cols});`;
    }

    return sql;
  }

  generateAddColumnSql(_schema: string, table: string, column: CreateTableColumn): string {
    return generateAddColumnDdl("main", table, column, SqliteAdapter.quote);
  }

  generateAlterTableSql(originalDef: CreateTableDefinition, newDef: CreateTableDefinition): string {
    return generateAlterTableSql(originalDef, newDef, {
      quote: SqliteAdapter.quote,
      supportsDropColumn: true,
      supportsAlterColumn: false,
      useModifyColumn: false,
    });
  }

  getSchemasQuery(): string {
    return `SELECT 'main' as schema_name;`;
  }

  // === CRUD SQL GENERATION ===

  private qi(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  quoteIdentifier(id: string): string {
    return this.qi(id);
  }

  paginateQuery(baseQuery: string, limit: number, offset: number): string {
    return `${baseQuery} LIMIT ${limit} OFFSET ${offset}`;
  }

  buildUpdateSql(
    schema: string,
    table: string,
    column: string,
    newValue: unknown,
    primaryKeys: string[],
    row: Record<string, unknown>,
    castLookup?: CastLookup,
  ): SqlWithBindings {
    return buildParamUpdate(
      schema,
      table,
      column,
      newValue,
      primaryKeys,
      row,
      (id) => this.qi(id),
      castLookup,
    );
  }

  buildSetDefaultSql(
    schema: string,
    table: string,
    column: string,
    primaryKeys: string[],
    row: Record<string, unknown>,
  ): SqlWithBindings {
    return buildParamSetDefault(schema, table, column, primaryKeys, row, (id) => this.qi(id));
  }

  buildInsertSql(
    schema: string,
    table: string,
    values: Record<string, unknown>,
    castLookup?: CastLookup,
  ): SqlWithBindings {
    return buildParamInsert(schema, table, values, (id) => this.qi(id), castLookup);
  }

  buildDeleteSql(
    schema: string,
    table: string,
    primaryKeys: string[],
    row: Record<string, unknown>,
  ): SqlWithBindings {
    return buildParamDelete(schema, table, primaryKeys, row, (id) => this.qi(id));
  }
}
