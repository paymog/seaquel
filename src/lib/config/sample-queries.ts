import type { DatabaseType } from "$lib/types";
import * as m from "$lib/paraglide/messages.js";

export interface SampleQuery {
  id: string;
  name: () => string;
  description: () => string;
  query: string;
  requiresTable?: boolean;
}

export const sampleQueries: Record<DatabaseType, SampleQuery[]> = {
  postgres: [
    {
      id: "pg-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;`,
    },
    {
      id: "pg-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT *
FROM your_table
LIMIT 10;`,
      requiresTable: true,
    },
    {
      id: "pg-table-size",
      name: () => m.sample_query_check_sizes(),
      description: () => m.sample_query_check_sizes_desc(),
      query: `SELECT
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;`,
    },
  ],
  mysql: [
    {
      id: "mysql-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SHOW TABLES;`,
    },
    {
      id: "mysql-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT *
FROM your_table
LIMIT 10;`,
      requiresTable: true,
    },
    {
      id: "mysql-table-size",
      name: () => m.sample_query_check_sizes(),
      description: () => m.sample_query_check_sizes_desc(),
      query: `SELECT
    table_name,
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY (data_length + index_length) DESC;`,
    },
  ],
  mariadb: [
    {
      id: "mariadb-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SHOW TABLES;`,
    },
    {
      id: "mariadb-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT *
FROM your_table
LIMIT 10;`,
      requiresTable: true,
    },
  ],
  sqlite: [
    {
      id: "sqlite-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SELECT name, type
FROM sqlite_master
WHERE type IN ('table', 'view')
ORDER BY name;`,
    },
    {
      id: "sqlite-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT *
FROM your_table
LIMIT 10;`,
      requiresTable: true,
    },
    {
      id: "sqlite-table-info",
      name: () => m.sample_query_view_structure(),
      description: () => m.sample_query_view_structure_desc(),
      query: `PRAGMA table_info(your_table);`,
      requiresTable: true,
    },
  ],
  mssql: [
    {
      id: "mssql-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SELECT TABLE_NAME, TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;`,
    },
    {
      id: "mssql-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT TOP 10 *
FROM your_table;`,
      requiresTable: true,
    },
  ],
  duckdb: [
    {
      id: "duckdb-list-tables",
      name: () => m.sample_query_list_tables(),
      description: () => m.sample_query_list_tables_desc(),
      query: `SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;`,
    },
    {
      id: "duckdb-sample-data",
      name: () => m.sample_query_preview_data(),
      description: () => m.sample_query_preview_data_desc(),
      query: `SELECT *
FROM your_table
LIMIT 10;`,
      requiresTable: true,
    },
    {
      id: "duckdb-describe-table",
      name: () => m.sample_query_describe_structure(),
      description: () => m.sample_query_describe_structure_desc(),
      query: `DESCRIBE your_table;`,
      requiresTable: true,
    },
    {
      id: "duckdb-import-csv",
      name: () => m.sample_query_import_csv(),
      description: () => m.sample_query_import_csv_desc(),
      query: `CREATE TABLE my_data AS
SELECT * FROM read_csv_auto('/path/to/file.csv');`,
    },
    {
      id: "duckdb-import-parquet",
      name: () => m.sample_query_import_parquet(),
      description: () => m.sample_query_import_parquet_desc(),
      query: `CREATE TABLE my_data AS
SELECT * FROM read_parquet('/path/to/file.parquet');`,
    },
  ],
};

export const savedQueryExample: SampleQuery = {
  id: "saved-example",
  name: () => "Active Users Report",
  description: () => "Find users who logged in recently",
  query: `SELECT
    name,
    email,
    last_login
FROM users
WHERE last_login > NOW() - INTERVAL '30 days'
ORDER BY last_login DESC;`,
};
