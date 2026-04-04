import type { DatabaseAdapter, ExplainNode } from "./index";
import { validateIdentifier } from "./index";
import { generateAlterTableSql, generateCreateTableDdl, generateAddColumnDdl } from "./alter-table";
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

interface DuckDBSchemaRow {
  schema_name: string;
  table_name: string;
}

interface DuckDBColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  is_primary_key: boolean;
}

/**
 * DuckDB adapter for SQL generation and result parsing.
 * DuckDB uses PostgreSQL-compatible SQL syntax.
 */
export class DuckDBAdapter implements DatabaseAdapter {
  getSchemaQuery(): string {
    return `SELECT
			table_schema AS schema_name,
			table_name
		FROM
			information_schema.tables
		WHERE
			table_type = 'BASE TABLE'
			AND table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY
			table_schema, table_name`;
  }

  getColumnsQuery(table: string, schema: string): string {
    return `SELECT
			c.column_name,
			c.data_type,
			c.is_nullable,
			c.column_default,
			COALESCE((
				SELECT true
				FROM duckdb_constraints() dc
				WHERE dc.constraint_type = 'PRIMARY KEY'
					AND dc.table_name = c.table_name
					AND dc.schema_name = c.table_schema
					AND list_contains(dc.constraint_column_names, c.column_name)
			), false) AS is_primary_key
		FROM information_schema.columns c
		WHERE c.table_name = '${validateIdentifier(table)}' AND c.table_schema = '${validateIdentifier(schema)}'
		ORDER BY c.ordinal_position`;
  }

  getIndexesQuery(_table: string, _schema: string): string {
    // DuckDB doesn't have traditional indexes exposed via information_schema
    // Return empty result
    return `SELECT NULL AS index_name WHERE 1=0`;
  }

  getForeignKeysQuery(table: string, schema: string): string {
    // Query DuckDB's constraint information for foreign keys
    return `SELECT
			unnest(constraint_column_names) AS column_name,
			split_part(unnest(constraint_column_names), '.', 1) AS source_column,
			split_part(constraint_text, 'REFERENCES ', 2) AS ref_info
		FROM duckdb_constraints()
		WHERE constraint_type = 'FOREIGN KEY'
			AND table_name = '${validateIdentifier(table)}'
			AND schema_name = '${validateIdentifier(schema)}'`;
  }

  getExplainQuery(query: string, analyze: boolean): string {
    const baseQuery = query.replace(/;$/, "");
    // DuckDB supports EXPLAIN and EXPLAIN ANALYZE
    return analyze ? `EXPLAIN ANALYZE ${baseQuery}` : `EXPLAIN ${baseQuery}`;
  }

  parseExplainResult(rows: unknown[], _analyze: boolean): ExplainNode {
    // DuckDB returns explain as text rows
    const lines = (rows as { explain_value?: string; "QUERY PLAN"?: string }[])
      .map((r) => r.explain_value || r["QUERY PLAN"] || "")
      .filter((l) => l.trim());

    const text = lines.join("\n");

    return {
      type: "Query Plan",
      label: text || "No plan available",
    };
  }

  parseSchemaResult(rows: unknown[]): SchemaTable[] {
    return (rows as DuckDBSchemaRow[]).map((row) => ({
      name: row.table_name,
      schema: row.schema_name,
      type: "table" as const,
      columns: [],
      indexes: [],
    }));
  }

  parseColumnsResult(rows: unknown[], foreignKeys?: unknown[]): SchemaColumn[] {
    // Build foreign key map from column name to reference
    const fkMap = new Map<string, ForeignKeyRef>();
    if (foreignKeys) {
      for (const fk of foreignKeys as { column_name: string; ref_info: string }[]) {
        // Parse ref_info which looks like "schema.table(column)"
        const refInfo = fk.ref_info || "";
        const match = refInfo.match(/^([^.]+)\.([^(]+)\(([^)]+)\)/);
        if (match) {
          fkMap.set(fk.column_name, {
            referencedSchema: match[1],
            referencedTable: match[2],
            referencedColumn: match[3],
          });
        }
      }
    }

    return (rows as DuckDBColumnRow[]).map((col) => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === "YES",
      defaultValue: col.column_default || undefined,
      isPrimaryKey: !!col.is_primary_key,
      isForeignKey: fkMap.has(col.column_name),
      foreignKeyRef: fkMap.get(col.column_name),
    }));
  }

  parseIndexesResult(_rows: unknown[]): SchemaIndex[] {
    // DuckDB doesn't expose index information in a standard way
    return [];
  }

  // === STATISTICS METHODS ===

  getTableSizesQuery(): string {
    // Get table names from information_schema
    return `SELECT
			table_schema AS schema_name,
			table_name
		FROM information_schema.tables
		WHERE table_type = 'BASE TABLE'
			AND table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY table_schema, table_name`;
  }

  getTableRowCountQuery(table: string, schema: string): string {
    return `SELECT COUNT(*) AS row_count FROM "${validateIdentifier(schema)}"."${validateIdentifier(table)}"`;
  }

  getIndexUsageQuery(): string {
    // DuckDB tracks indexes via duckdb_indexes() function
    return `SELECT
			schema_name,
			table_name,
			index_name,
			is_unique
		FROM duckdb_indexes()
		ORDER BY schema_name, table_name, index_name`;
  }

  getDatabaseOverviewQuery(): string {
    // Get basic database stats
    return `SELECT
			(SELECT COUNT(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count,
			(SELECT COUNT(*) FROM duckdb_indexes()) AS index_count,
			0 AS total_size_bytes`;
  }

  parseTableSizesResult(rows: unknown[]): TableSizeInfo[] {
    return (rows as { schema_name: string; table_name: string }[]).map((row) => ({
      schema: row.schema_name || "main",
      name: row.table_name,
      rowCount: 0, // Filled in separately via getTableRowCountQuery
      totalSize: "N/A",
      totalSizeBytes: 0,
    }));
  }

  parseIndexUsageResult(rows: unknown[]): IndexUsageInfo[] {
    return (
      rows as { schema_name: string; table_name: string; index_name: string; is_unique: boolean }[]
    ).map((row) => ({
      schema: row.schema_name || "main",
      table: row.table_name,
      indexName: row.index_name,
      size: "N/A",
      scans: 0,
      unused: false,
    }));
  }

  parseDatabaseOverviewResult(rows: unknown[]): DatabaseOverview {
    const row = (
      rows as { table_count: number; index_count: number; total_size_bytes: number }[]
    )[0];
    return {
      databaseName: "DuckDB Database",
      totalSize: "In-memory",
      totalSizeBytes: 0,
      tableCount: Number(row?.table_count) || 0,
      indexCount: Number(row?.index_count) || 0,
    };
  }

  // === CREATE TABLE METHODS ===

  getColumnTypes(): ColumnTypeInfo[] {
    return [
      // String
      { name: "VARCHAR", category: "String", hasLength: true },
      { name: "TEXT", category: "String" },
      // Numeric
      { name: "INTEGER", category: "Numeric" },
      { name: "BIGINT", category: "Numeric" },
      { name: "HUGEINT", category: "Numeric" },
      { name: "SMALLINT", category: "Numeric" },
      { name: "TINYINT", category: "Numeric" },
      { name: "DOUBLE", category: "Numeric" },
      { name: "FLOAT", category: "Numeric" },
      { name: "DECIMAL", category: "Numeric", hasPrecision: true },
      // Date/Time
      { name: "DATE", category: "Date/Time" },
      { name: "TIME", category: "Date/Time" },
      { name: "TIMESTAMP", category: "Date/Time" },
      { name: "INTERVAL", category: "Date/Time" },
      // Boolean
      { name: "BOOLEAN", category: "Boolean" },
      // JSON
      { name: "JSON", category: "JSON" },
      // Binary
      { name: "BLOB", category: "Binary" },
      // UUID
      { name: "UUID", category: "UUID" },
      // Other
      { name: "LIST", category: "Other" },
      { name: "MAP", category: "Other" },
      { name: "STRUCT", category: "Other" },
    ];
  }

  private static readonly quote = (n: string) => `"${n}"`;

  generateCreateTableSql(definition: CreateTableDefinition): string {
    return generateCreateTableDdl(definition, DuckDBAdapter.quote);
  }

  generateAddColumnSql(schema: string, table: string, column: CreateTableColumn): string {
    return generateAddColumnDdl(schema, table, column, DuckDBAdapter.quote);
  }

  generateAlterTableSql(originalDef: CreateTableDefinition, newDef: CreateTableDefinition): string {
    return generateAlterTableSql(originalDef, newDef, {
      quote: DuckDBAdapter.quote,
      supportsDropColumn: true,
      supportsAlterColumn: true,
      useModifyColumn: false,
    });
  }

  getSchemasQuery(): string {
    return `SELECT schema_name FROM information_schema.schemata WHERE catalog_name NOT IN ('system', 'temp') ORDER BY schema_name;`;
  }
}
