import type {
  Dashboard,
  DashboardVersion,
  DashboardSnapshot,
  ResolvedDashboardVersion,
} from "$lib/types";
import { stripWidgetRuntimeState } from "$lib/hooks/database/dashboard-manager.svelte";

/**
 * Create a snapshot from a Dashboard's current state.
 * Strips runtime widget state (result, isLoading, error, lastRefreshed).
 */
export function createDashboardSnapshot(dashboard: Dashboard): DashboardSnapshot {
  return {
    name: dashboard.name,
    description: dashboard.description,
    widgets: dashboard.widgets.map(stripWidgetRuntimeState),
    viewport: dashboard.viewport,
    dateFilter: dashboard.dateFilter,
  };
}

/**
 * Create a new DashboardVersion entry (always a full snapshot).
 */
export function createDashboardVersionEntry(
  dashboardId: string,
  version: number,
  dashboard: Dashboard,
): DashboardVersion {
  return {
    id: `dver-${crypto.randomUUID()}`,
    dashboardId,
    version,
    snapshot: JSON.stringify(createDashboardSnapshot(dashboard)),
    createdAt: new Date(),
  };
}

/**
 * Resolve versions by parsing JSON snapshots.
 * Input versions are sorted by version number; output preserves that order.
 */
export function resolveDashboardVersions(versions: DashboardVersion[]): ResolvedDashboardVersion[] {
  return [...versions]
    .sort((a, b) => a.version - b.version)
    .map((v) => ({
      id: v.id,
      dashboardId: v.dashboardId,
      version: v.version,
      dashboard: JSON.parse(v.snapshot) as DashboardSnapshot,
      createdAt: v.createdAt,
    }));
}
