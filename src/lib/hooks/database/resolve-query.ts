import type { QueryTab, ParameterValue } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import { getStatementAtOffset } from "$lib/db/sql-parser";
import { substituteParameters } from "$lib/db/query-params";

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
  const projectId = state.activeProjectId;
  if (!projectId) return null;

  const tabs = state.queryTabsByProject[projectId] ?? [];
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || !tab.query.trim()) return null;

  const dbType = state.activeConnection?.type ?? "postgres";
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
