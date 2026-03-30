/**
 * Types for the Data Viewer feature.
 * @module types/data-tab
 */

import type { StatementResult } from "./query";

/**
 * Filter operator for the data viewer WHERE clause builder.
 */
export type DataFilterOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "NOT LIKE"
  | "IN"
  | "NOT IN"
  | "IS NULL"
  | "IS NOT NULL";

/**
 * A single filter condition in the data viewer.
 */
export interface DataFilter {
  id: string;
  column: string;
  operator: DataFilterOperator;
  value: string;
  enabled: boolean;
}

/**
 * A sort directive for the data viewer.
 */
export interface DataSort {
  column: string;
  direction: "ASC" | "DESC";
}

/**
 * Tab state for the Data Viewer.
 */
export interface DataTab {
  id: string;
  connectionId: string;
  tableName: string;
  schemaName: string;
  filters: DataFilter[];
  filterLogic: "AND" | "OR";
  sortColumns: DataSort[];
  page: number;
  pageSize: number;
  results?: StatementResult;
  isLoading: boolean;
  /** Rows being added inline that haven't been saved yet */
  pendingNewRows: Record<string, unknown>[];
  /** Total row count for pagination */
  totalRows?: number;
}
