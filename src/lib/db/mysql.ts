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

/** MySQL information_schema may return VARBINARY columns as byte arrays; decode to string */
function decodeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String.fromCharCode(...value);
  // oxlint-disable-next-line typescript-eslint(no-base-to-string)
  return String(value ?? "");
}

interface MysqlSchemaRow {
  schema_name: string;
  table_name: string;
  table_type: string;
}

interface MysqlColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  is_primary_key: number;
  is_foreign_key: number;
  foreign_key_ref: string | null;
}

interface MysqlIndexRow {
  index_name: string;
  column_name: string;
  non_unique: number;
  index_type: string;
}

interface MysqlTableSizeRow {
  schema_name: string;
  table_name: string;
  row_count: number;
  total_size: string;
  total_size_bytes: number;
  data_size: string;
  index_size: string;
}

interface MysqlIndexUsageRow {
  schema_name: string;
  table_name: string;
  index_name: string;
  size: string;
  scans: number;
  rows_read: number;
  unused: boolean;
}

interface MysqlDatabaseOverviewRow {
  database_name: string;
  total_size: string;
  total_size_bytes: number;
  table_count: number;
  index_count: number;
  connection_count: number;
}

export class MysqlAdapter implements DatabaseAdapter {
  getSchemaQuery(): string {
    return `SELECT
			table_schema AS schema_name,
			table_name AS table_name,
			table_type
		FROM
			information_schema.tables
		WHERE
			table_type IN ('BASE TABLE', 'VIEW')
			AND table_schema = DATABASE()
		ORDER BY
			table_schema, table_name`;
  }

  getColumnsQuery(table: string, schema: string): string {
    return `SELECT
			c.COLUMN_NAME AS column_name,
			c.COLUMN_TYPE AS data_type,
			c.IS_NULLABLE AS is_nullable,
			c.COLUMN_DEFAULT AS column_default,
			IF(c.COLUMN_KEY = 'PRI', 1, 0) AS is_primary_key,
			IF(c.COLUMN_KEY = 'MUL' AND EXISTS (
				SELECT 1 FROM information_schema.KEY_COLUMN_USAGE kcu
				WHERE kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
					AND kcu.TABLE_NAME = c.TABLE_NAME
					AND kcu.COLUMN_NAME = c.COLUMN_NAME
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
			), 1, 0) AS is_foreign_key,
			(SELECT CONCAT(kcu.REFERENCED_TABLE_SCHEMA, '.', kcu.REFERENCED_TABLE_NAME, '.', kcu.REFERENCED_COLUMN_NAME)
				FROM information_schema.KEY_COLUMN_USAGE kcu
				WHERE kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
					AND kcu.TABLE_NAME = c.TABLE_NAME
					AND kcu.COLUMN_NAME = c.COLUMN_NAME
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				LIMIT 1
			) AS foreign_key_ref
		FROM information_schema.COLUMNS c
		WHERE c.TABLE_NAME = '${validateIdentifier(table)}' AND c.TABLE_SCHEMA = '${validateIdentifier(schema)}'
		ORDER BY c.ORDINAL_POSITION`;
  }

  getIndexesQuery(table: string, schema: string): string {
    return `SELECT
			INDEX_NAME AS index_name,
			COLUMN_NAME AS column_name,
			NON_UNIQUE AS non_unique,
			INDEX_TYPE AS index_type
		FROM information_schema.STATISTICS
		WHERE TABLE_NAME = '${validateIdentifier(table)}' AND TABLE_SCHEMA = '${validateIdentifier(schema)}'
		ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
  }

  getExplainQuery(query: string, analyze: boolean): string {
    const baseQuery = query.replace(/;$/, "");
    return analyze ? `EXPLAIN ANALYZE ${baseQuery}` : `EXPLAIN FORMAT=JSON ${baseQuery}`;
  }

  parseExplainResult(rows: unknown[], analyze: boolean): ExplainNode {
    if (analyze) {
      // EXPLAIN ANALYZE returns text rows in MySQL 8.0.18+
      const lines = (rows as Record<string, string>[]).map((r) => Object.values(r)[0] || "");
      return {
        type: "Query",
        label: lines.join("\n"),
      };
    }

    // EXPLAIN FORMAT=JSON returns a single row with EXPLAIN column
    const result = rows as Record<string, unknown>[];
    const jsonStr = Object.values(result[0] || {})[0];
    const parsed = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
    const queryBlock = (parsed as { query_block?: Record<string, unknown> })?.query_block;

    if (!queryBlock) {
      return { type: "Query", label: "Query" };
    }

    return this.convertMysqlPlanNode(queryBlock);
  }

  private convertMysqlPlanNode(node: Record<string, unknown>): ExplainNode {
    const table = node["table"] as Record<string, unknown> | undefined;
    const nestedLoop = node["nested_loop"] as Record<string, unknown>[] | undefined;

    if (table) {
      return {
        type: (table["access_type"] as string) || "ALL",
        // oxlint-disable-next-line
        label: `${table["table_name"] || "unknown"} (${table["access_type"] || "ALL"})`,
        rows: table["rows_examined_per_scan"] as number | undefined,
        cost: table["read_cost"]
          ? Number(table["read_cost"])
          : table["eval_cost"]
            ? Number(table["eval_cost"])
            : undefined,
      };
    }

    if (nestedLoop) {
      return {
        type: "Nested Loop",
        label: "Nested Loop",
        children: nestedLoop.map((item) => this.convertMysqlPlanNode(item)),
      };
    }

    return {
      type: "Query Block",
      label: "Query Block",
      cost: node["cost_info"]
        ? Number((node["cost_info"] as Record<string, unknown>)["query_cost"])
        : undefined,
    };
  }

  parseSchemaResult(rows: unknown[]): SchemaTable[] {
    return (rows as MysqlSchemaRow[])
      .map((row) => ({
        name: decodeValue(row.table_name),
        schema: decodeValue(row.schema_name),
        type: (row.table_type === "VIEW" ? "view" : "table") as SchemaTable["type"],
        columns: [],
        indexes: [],
      }))
      .filter((t) => t.name !== "");
  }

  parseColumnsResult(rows: unknown[]): SchemaColumn[] {
    return (rows as MysqlColumnRow[]).map((col) => {
      const fkRef = col.foreign_key_ref ? decodeValue(col.foreign_key_ref) : null;
      let foreignKeyRef: ForeignKeyRef | undefined;
      if (fkRef) {
        const parts = fkRef.split(".");
        if (parts.length === 3) {
          foreignKeyRef = {
            referencedSchema: parts[0],
            referencedTable: parts[1],
            referencedColumn: parts[2],
          };
        }
      }
      return {
        name: decodeValue(col.column_name),
        type: decodeValue(col.data_type),
        nullable: decodeValue(col.is_nullable) === "YES",
        defaultValue: col.column_default ? decodeValue(col.column_default) : undefined,
        isPrimaryKey: !!col.is_primary_key,
        isForeignKey: !!col.is_foreign_key,
        foreignKeyRef,
      };
    });
  }

  parseIndexesResult(rows: unknown[]): SchemaIndex[] {
    // Group rows by index name since MySQL returns one row per column
    const indexMap = new Map<string, { columns: string[]; unique: boolean; type: string }>();
    for (const row of rows as MysqlIndexRow[]) {
      const name = decodeValue(row.index_name);
      const colName = decodeValue(row.column_name);
      const existing = indexMap.get(name);
      if (existing) {
        existing.columns.push(colName);
      } else {
        indexMap.set(name, {
          columns: [colName],
          unique: !row.non_unique,
          type: decodeValue(row.index_type).toLowerCase(),
        });
      }
    }

    return Array.from(indexMap.entries()).map(([name, info]) => ({
      name,
      columns: info.columns,
      unique: info.unique,
      type: info.type,
    }));
  }

  // === STATISTICS METHODS ===

  getTableSizesQuery(): string {
    return `SELECT
			TABLE_SCHEMA AS schema_name,
			TABLE_NAME AS table_name,
			TABLE_ROWS AS row_count,
			CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024, 2), ' KB') AS total_size,
			(DATA_LENGTH + INDEX_LENGTH) AS total_size_bytes,
			CONCAT(ROUND(DATA_LENGTH / 1024, 2), ' KB') AS data_size,
			CONCAT(ROUND(INDEX_LENGTH / 1024, 2), ' KB') AS index_size
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`;
  }

  getIndexUsageQuery(): string {
    return `SELECT
			TABLE_SCHEMA AS schema_name,
			TABLE_NAME AS table_name,
			INDEX_NAME AS index_name,
			CONCAT(ROUND(STAT_VALUE * @@innodb_page_size / 1024, 2), ' KB') AS size,
			0 AS scans,
			0 AS rows_read,
			0 AS unused
		FROM mysql.innodb_index_stats
		WHERE stat_name = 'size' AND TABLE_SCHEMA = DATABASE()
		ORDER BY STAT_VALUE DESC`;
  }

  getDatabaseOverviewQuery(): string {
    return `SELECT
			DATABASE() AS database_name,
			CONCAT(ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024, 2), ' KB') AS total_size,
			SUM(DATA_LENGTH + INDEX_LENGTH) AS total_size_bytes,
			COUNT(*) AS table_count,
			(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()) AS index_count,
			(SELECT COUNT(*) FROM information_schema.PROCESSLIST) AS connection_count
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;
  }

  parseTableSizesResult(rows: unknown[]): TableSizeInfo[] {
    return (rows as MysqlTableSizeRow[]).map((row) => ({
      schema: row.schema_name,
      name: row.table_name,
      rowCount: Number(row.row_count) || 0,
      totalSize: row.total_size,
      totalSizeBytes: Number(row.total_size_bytes) || 0,
      dataSize: row.data_size,
      indexSize: row.index_size,
    }));
  }

  parseIndexUsageResult(rows: unknown[]): IndexUsageInfo[] {
    return (rows as MysqlIndexUsageRow[]).map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      indexName: row.index_name,
      size: row.size,
      scans: Number(row.scans) || 0,
      rowsRead: Number(row.rows_read) || 0,
      unused: !!row.unused,
    }));
  }

  parseDatabaseOverviewResult(rows: unknown[]): DatabaseOverview {
    const row = (rows as MysqlDatabaseOverviewRow[])[0];
    return {
      databaseName: row?.database_name ?? "Unknown",
      totalSize: row?.total_size ?? "0 bytes",
      totalSizeBytes: Number(row?.total_size_bytes) || 0,
      tableCount: Number(row?.table_count) || 0,
      indexCount: Number(row?.index_count) || 0,
      connectionCount: Number(row?.connection_count) || 0,
    };
  }

  // === CREATE TABLE METHODS ===

  getColumnTypes(): ColumnTypeInfo[] {
    return [
      // String
      { name: "VARCHAR", category: "String", hasLength: true },
      { name: "CHAR", category: "String", hasLength: true },
      { name: "TEXT", category: "String" },
      { name: "TINYTEXT", category: "String" },
      { name: "MEDIUMTEXT", category: "String" },
      { name: "LONGTEXT", category: "String" },
      { name: "ENUM", category: "String" },
      { name: "SET", category: "String" },
      // Numeric
      { name: "INT", category: "Numeric" },
      { name: "TINYINT", category: "Numeric" },
      { name: "SMALLINT", category: "Numeric" },
      { name: "MEDIUMINT", category: "Numeric" },
      { name: "BIGINT", category: "Numeric" },
      { name: "FLOAT", category: "Numeric" },
      { name: "DOUBLE", category: "Numeric" },
      { name: "DECIMAL", category: "Numeric", hasPrecision: true },
      // Date/Time
      { name: "DATE", category: "Date/Time" },
      { name: "DATETIME", category: "Date/Time" },
      { name: "TIMESTAMP", category: "Date/Time" },
      { name: "TIME", category: "Date/Time" },
      { name: "YEAR", category: "Date/Time" },
      // Boolean
      { name: "BOOLEAN", category: "Boolean" },
      // JSON
      { name: "JSON", category: "JSON" },
      // Binary
      { name: "BINARY", category: "Binary", hasLength: true },
      { name: "VARBINARY", category: "Binary", hasLength: true },
      { name: "BLOB", category: "Binary" },
      { name: "TINYBLOB", category: "Binary" },
      { name: "MEDIUMBLOB", category: "Binary" },
      { name: "LONGBLOB", category: "Binary" },
    ];
  }

  private static readonly quote = (n: string) => `\`${n}\``;

  generateCreateTableSql(definition: CreateTableDefinition): string {
    return generateCreateTableDdl(definition, MysqlAdapter.quote);
  }

  generateAddColumnSql(schema: string, table: string, column: CreateTableColumn): string {
    return generateAddColumnDdl(schema, table, column, MysqlAdapter.quote);
  }

  generateAlterTableSql(originalDef: CreateTableDefinition, newDef: CreateTableDefinition): string {
    return generateAlterTableSql(originalDef, newDef, {
      quote: MysqlAdapter.quote,
      supportsDropColumn: true,
      supportsAlterColumn: true,
      useModifyColumn: true,
    });
  }

  getSchemasQuery(): string {
    return `SELECT SCHEMA_NAME as schema_name FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME;`;
  }
}
