/**
 * Types for the Create Table feature.
 * @module types/create-table
 */

/**
 * Describes a column type available for a specific database engine.
 */
export interface ColumnTypeInfo {
  /** Type name as used in DDL, e.g. "VARCHAR", "INTEGER" */
  name: string;
  /** Grouping category for the UI picker */
  category:
    | "String"
    | "Numeric"
    | "Date/Time"
    | "Boolean"
    | "JSON"
    | "Binary"
    | "UUID"
    | "Network"
    | "Other";
  /** Whether the type accepts a length parameter, e.g. VARCHAR(255) */
  hasLength?: boolean;
  /** Whether the type accepts precision/scale, e.g. DECIMAL(10,2) */
  hasPrecision?: boolean;
}

/**
 * A single column definition in the Create Table form.
 */
export interface CreateTableColumn {
  /** Stable ID for keying in lists */
  id: string;
  name: string;
  type: string;
  /** Length parameter, e.g. 255 for VARCHAR(255) */
  length?: string;
  /** Precision parameter, e.g. "10,2" for DECIMAL(10,2) */
  precision?: string;
  nullable: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
}

/**
 * An index definition in the Create Table form.
 */
export interface CreateTableIndex {
  id: string;
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
}

/**
 * A foreign key constraint in the Create Table form.
 */
export interface CreateTableForeignKey {
  id: string;
  column: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
}

/**
 * Complete table definition being built in the Create Table form.
 */
export interface CreateTableDefinition {
  tableName: string;
  schemaName: string;
  columns: CreateTableColumn[];
  indexes: CreateTableIndex[];
  foreignKeys: CreateTableForeignKey[];
}

/**
 * Tab state for the Create Table editor.
 */
export interface CreateTableTab {
  id: string;
  connectionId: string;
  name: string;
  tableDefinition: CreateTableDefinition;
  generatedSql?: string;
  /** True when editing an existing table rather than creating a new one */
  isEditMode?: boolean;
  /** The original definition when editing, used to compute ALTER TABLE diffs */
  originalDefinition?: CreateTableDefinition;
}
