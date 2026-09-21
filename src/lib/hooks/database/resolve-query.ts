import type { QueryTab, ParameterValue, DatabaseConnection } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import { getStatementAtOffset } from "$lib/db/sql-parser";
import { substituteParameters } from "$lib/db/query-params";

export function getQueryTab(state: DatabaseState, tabId: string): QueryTab | null {
  const projectId = state.activeProjectId;
  if (!projectId) return null;
  const tabs = state.queryTabsByProject[projectId] ?? [];
  return tabs.find((t) => t.id === tabId) ?? null;
}

export function getQueryTabConnection(
  state: DatabaseState,
  tabId: string,
): DatabaseConnection | null {
  const tab = getQueryTab(state, tabId);
  if (!tab?.connectionId) return null;
  return state.connections.find((c) => c.id === tab.connectionId) ?? null;
}

/**
 * Resolve query text from a query tab, optionally extracting the statement at cursor
 * and substituting parameters. Shared across explain-tabs, visualize-tabs, and query-execution.
 */
export function resolveQuery(
  state: DatabaseState,
  tabId: string,
  cursorOffset?: number,
  parameterValues?: ParameterValue[],
  forceInline?: boolean,
): { tab: QueryTab; query: string; bindValues?: unknown[] } | null {
  const tab = getQueryTab(state, tabId);
  if (!tab || !tab.query.trim()) return null;

  const connection = getQueryTabConnection(state, tabId);
  const dbType = connection?.type ?? "postgres";
  let query = tab.query;

  if (cursorOffset !== undefined) {
    const statement = getStatementAtOffset(tab.query, cursorOffset, dbType);
    if (statement) query = statement.sql;
  }

  if (!query.trim()) return null;

  if (parameterValues) {
    const { sql, bindValues } = substituteParameters(query, parameterValues, dbType, forceInline);
    return { tab, query: sql, bindValues };
  }
  return { tab, query };
}
