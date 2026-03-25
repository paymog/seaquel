/**
 * Parser for dashboard .json files in shared repos.
 */
import type { SharedDashboard } from "$lib/types";
import type { DashboardWidget } from "$lib/types/dashboard";
import { log } from "$lib/utils/logger";
import { stripWidgetRuntimeState } from "$lib/hooks/database/dashboard-manager.svelte.js";

interface DashboardFileContent {
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  viewport?: { x: number; y: number; zoom: number };
  dateFilter?: { start: string; end: string } | null;
}

/**
 * Parse a dashboard .json file into a SharedDashboard object.
 */
export function parseDashboardFile(
  content: string,
  repoId: string,
  filePath: string,
): SharedDashboard | null {
  try {
    const data: DashboardFileContent = JSON.parse(content);

    if (!data.name) {
      const fileName = filePath.split("/").pop() || "untitled";
      data.name = fileName.replace(/\.json$/i, "").replace(/[-_]/g, " ");
    }

    // Strip runtime state from widgets
    const widgets = (data.widgets ?? []).map(stripWidgetRuntimeState) as DashboardWidget[];

    return {
      id: `${repoId}:${filePath}`,
      repoId,
      filePath,
      name: data.name,
      description: data.description,
      widgets,
      viewport: data.viewport ?? { x: 0, y: 0, zoom: 1 },
      dateFilter: data.dateFilter ?? null,
    };
  } catch {
    void log.warn(`Failed to parse dashboard file: ${filePath}`);
    return null;
  }
}

/**
 * Serialize a SharedDashboard to JSON file content.
 */
export function serializeDashboardFile(dashboard: SharedDashboard): string {
  // Strip runtime state from widgets
  const widgets = dashboard.widgets.map(stripWidgetRuntimeState);

  const content: DashboardFileContent = {
    name: dashboard.name,
    ...(dashboard.description && { description: dashboard.description }),
    widgets,
    viewport: dashboard.viewport,
    ...(dashboard.dateFilter && { dateFilter: dashboard.dateFilter }),
  };

  return JSON.stringify(content, null, 2) + "\n";
}

/**
 * Generate a valid filename from a dashboard name.
 */
export function dashboardNameToFilename(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "untitled"}.json`;
}
