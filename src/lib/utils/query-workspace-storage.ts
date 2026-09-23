import { getAuthUser } from "$lib/auth/token";
import { isBrowser, isServer } from "$lib/utils/environment";

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

/** User segment for workspace keys; null when server mode has no authenticated user yet. */
function workspaceUserKey(): string | null {
  const user = getAuthUser();
  if (user) return user;
  if (isServer()) return null;
  return "local";
}

export function isQueryWorkspacePersistenceAvailable(): boolean {
  return workspaceUserKey() !== null;
}

function workspaceKey(projectId: string): string | null {
  const user = workspaceUserKey();
  if (!user) return null;
  return `seaquel:query-workspace:${user}:${projectId}`;
}

function migratedKey(projectId: string): string | null {
  const user = workspaceUserKey();
  if (!user) return null;
  return `seaquel:query-workspace-migrated:${user}:${projectId}`;
}

export function serializeQueryWorkspaceSnapshot(
  tabs: ReadonlyArray<{
    id: string;
    name: string;
    query: string;
    queryId?: string;
    connectionId?: string;
  }>,
  activeTabId: string | null,
): QueryWorkspaceState {
  return {
    tabs: tabs.map(({ id, name, query, queryId, connectionId }) => ({
      id,
      name,
      query,
      queryId,
      connectionId,
    })),
    activeTabId,
  };
}

export function loadQueryWorkspace(projectId: string): QueryWorkspaceState | null {
  if (!isBrowser()) return null;
  const key = workspaceKey(projectId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
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

/** Returns true when the snapshot was written to localStorage. */
export function saveQueryWorkspace(projectId: string, state: QueryWorkspaceState): boolean {
  if (!isBrowser()) return false;
  const key = workspaceKey(projectId);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    // ignore quota / private mode
    return false;
  }
}

export function isQueryWorkspaceMigrated(projectId: string): boolean {
  if (!isBrowser()) return false;
  const key = migratedKey(projectId);
  if (!key) return false;
  return localStorage.getItem(key) === "1";
}

export function markQueryWorkspaceMigrated(projectId: string): void {
  if (!isBrowser()) return;
  const key = migratedKey(projectId);
  if (!key) return;
  localStorage.setItem(key, "1");
}
