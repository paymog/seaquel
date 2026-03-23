/**
 * Persisted state types for storing data across app restarts.
 * These types use ISO string dates instead of Date objects for JSON serialization.
 * @module types/persisted
 */

import type { ConnectionLabel } from "./project";

/**
 * Persisted query tab state.
 * Stores query content but not execution results.
 */
export interface PersistedQueryTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** SQL query text */
  query: string;
  /** ID of the saved query this tab was loaded from */
  savedQueryId?: string;
  /** ID of the shared query this tab was loaded from */
  sharedQueryId?: string;
}

/**
 * Persisted schema tab state.
 * Stores reference to the viewed table.
 */
export interface PersistedSchemaTab {
  /** Tab identifier */
  id: string;
  /** Name of the table being viewed */
  tableName: string;
  /** Schema name of the table */
  schemaName: string;
}

/**
 * Persisted EXPLAIN tab state.
 */
export interface PersistedExplainTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** The original query that was explained */
  sourceQuery: string;
}

/**
 * Persisted ERD tab state.
 */
export interface PersistedErdTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Connection ID this ERD tab belongs to */
  connectionId?: string;
}

/**
 * Persisted statistics tab state.
 */
export interface PersistedStatisticsTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Connection ID this statistics tab belongs to */
  connectionId: string;
}

/**
 * Persisted workflow tab state.
 */
export interface PersistedWorkflowTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Connection ID this workflow tab belongs to */
  connectionId: string;
}

/**
 * Persisted query visualizer tab state.
 */
export interface PersistedVisualizeTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** The original SQL query being visualized */
  sourceQuery: string;
}

/**
 * Persisted starter tab state.
 */
export interface PersistedStarterTab {
  /** Tab identifier */
  id: string;
  /** Type of starter tab */
  type: "getting-started" | "migration-tips";
  /** Tab display name */
  name: string;
  /** Whether the tab can be closed */
  closable: boolean;
}

/**
 * Persisted query parameter definition.
 */
export interface PersistedQueryParameter {
  /** Parameter name */
  name: string;
  /** Data type */
  type: "text" | "number" | "date" | "datetime" | "boolean";
  /** Optional default value */
  defaultValue?: string;
  /** Description/label */
  description?: string;
}

/**
 * Persisted saved query.
 * Uses ISO strings for dates.
 */
export interface PersistedSavedQuery {
  /** Query identifier */
  id: string;
  /** User-defined name */
  name: string;
  /** SQL query text */
  query: string;
  /** Project this query belongs to */
  projectId: string;
  /** When first saved (ISO 8601 string) */
  createdAt: string;
  /** When last modified (ISO 8601 string) */
  updatedAt: string;
  /** Optional parameter definitions */
  parameters?: PersistedQueryParameter[];
  /** Whether this query is starred */
  starred?: boolean;
}

/**
 * Persisted query history entry.
 * Uses ISO strings for dates.
 */
export interface PersistedQueryHistoryItem {
  /** Entry identifier */
  id: string;
  /** The executed SQL query */
  query: string;
  /** When executed (ISO 8601 string) */
  timestamp: string;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Number of rows returned or affected */
  rowCount: number;
  /** Connection this query was run on */
  connectionId: string;
  /** Whether marked as favorite */
  favorite: boolean;
  /** Snapshot of connection labels at execution time */
  connectionLabelsSnapshot: ConnectionLabel[];
  /** Connection name at execution time */
  connectionNameSnapshot: string;
}

/**
 * View type options for the main workspace.
 */
/**
 * Persisted connection tab state.
 * Only stores minimal data since connection tabs are transient.
 */
export interface PersistedConnectionTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
}

/**
 * Persisted dashboard tab state.
 */
export interface PersistedDashboardTab {
  /** Tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Dashboard ID this tab references */
  dashboardId: string;
}

export type ActiveViewType =
  | "query"
  | "schema"
  | "explain"
  | "erd"
  | "statistics"
  | "workflow"
  | "visualize"
  | "connection"
  | "dashboard";

/**
 * Complete persisted state for a single connection.
 * Stores all tabs, history, and UI state.
 */
export interface PersistedConnectionState {
  /** Connection identifier */
  connectionId: string;
  /** Query editor tabs */
  queryTabs: PersistedQueryTab[];
  /** Schema browser tabs */
  schemaTabs: PersistedSchemaTab[];
  /** EXPLAIN viewer tabs */
  explainTabs: PersistedExplainTab[];
  /** ERD viewer tabs */
  erdTabs: PersistedErdTab[];
  /** Statistics dashboard tabs */
  statisticsTabs: PersistedStatisticsTab[];
  /** Workflow tabs */
  workflowTabs: PersistedWorkflowTab[];
  /** Query visualizer tabs */
  visualizeTabs: PersistedVisualizeTab[];
  /** Ordered list of all tab IDs for drag-drop ordering */
  tabOrder: string[];
  /** Currently active query tab */
  activeQueryTabId: string | null;
  /** Currently active schema tab */
  activeSchemaTabId: string | null;
  /** Currently active explain tab */
  activeExplainTabId: string | null;
  /** Currently active ERD tab */
  activeErdTabId: string | null;
  /** Currently active statistics tab */
  activeStatisticsTabId: string | null;
  /** Currently active workflow tab */
  activeWorkflowTabId: string | null;
  /** Currently active visualize tab */
  activeVisualizeTabId: string | null;
  /** Which view type is currently active */
  activeView: ActiveViewType;
  /** Saved queries for this connection */
  savedQueries: PersistedSavedQuery[];
  /** Query execution history */
  queryHistory: PersistedQueryHistoryItem[];
}
