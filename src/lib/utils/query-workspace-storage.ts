import { getAuthUser } from "$lib/auth/token";
import { isBrowser } from "$lib/utils/environment";

export interface PersistedQueryWorkspaceTab {
  id: string;
  name: string;
  query: string;
  queryId?: string;
  connectionId?: string;
}

export interface QueryWorkspaceState {
  tabs: PersistedQueryWorkspaceTab[];
  activeTabId: string | null;
}

function workspaceKey(projectId: string): string {
  const user = getAuthUser() ?? "local";
  return `seaquel:query-workspace:${user}:${projectId}`;
}

function migratedKey(projectId: string): string {
  const user = getAuthUser() ?? "local";
  return `seaquel:query-workspace-migrated:${user}:${projectId}`;
}

export function loadQueryWorkspace(projectId: string): QueryWorkspaceState | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(workspaceKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QueryWorkspaceState>;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    return {
      tabs: parsed.tabs,
      activeTabId: parsed.activeTabId ?? null,
    };
  } catch {
    return null;
  }
}

export function saveQueryWorkspace(projectId: string, state: QueryWorkspaceState): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(workspaceKey(projectId), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function isQueryWorkspaceMigrated(projectId: string): boolean {
  return isBrowser() && localStorage.getItem(migratedKey(projectId)) === "1";
}

export function markQueryWorkspaceMigrated(projectId: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(migratedKey(projectId), "1");
}
