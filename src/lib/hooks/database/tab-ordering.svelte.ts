import type {
  QueryTab,
  SchemaTab,
  ExplainTab,
  ErdTab,
  StatisticsTab,
  WorkflowTab,
  VisualizeTab,
  ConnectionTab,
  DashboardTab,
  StarterTab,
  SettingsTab,
  CreateTableTab,
  DataTab,
  ExtensionsDuckdbTab,
} from "$lib/types";
import type { ActiveViewType } from "$lib/types/persisted";
import type { DatabaseState } from "./state.svelte.js";
import type { PaneManager } from "./pane-manager.svelte.js";

export type OrderedTabEntry = {
  id: string;
  type: ActiveViewType;
  tab:
    | QueryTab
    | SchemaTab
    | ExplainTab
    | ErdTab
    | StatisticsTab
    | WorkflowTab
    | VisualizeTab
    | ConnectionTab
    | DashboardTab
    | StarterTab
    | SettingsTab
    | CreateTableTab
    | DataTab
    | ExtensionsDuckdbTab;
};

/**
 * Manages tab ordering across all tab types (query, schema, explain, ERD).
 * Tabs are now organized per-project instead of per-connection.
 * Provides generic tab removal logic and ordered tab computation.
 */
export class TabOrderingManager {
  paneManager?: PaneManager;

  constructor(
    private state: DatabaseState,
    private schedulePersistence: (projectId: string | null) => void,
    paneManager?: PaneManager,
  ) {
    this.paneManager = paneManager;
  }

  /**
   * Generic tab removal helper used by all tab managers.
   * Handles removing from tab list and updating active tab selection.
   */
  removeTabGeneric<T extends { id: string }>(
    tabsGetter: () => Record<string, T[]>,
    tabsSetter: (r: Record<string, T[]>) => void,
    activeIdGetter: () => Record<string, string | null>,
    activeIdSetter: (r: Record<string, string | null>) => void,
    tabId: string,
  ): void {
    if (!this.state.activeProjectId) return;

    const projectId = this.state.activeProjectId;
    const tabs = tabsGetter()[projectId] ?? [];
    const index = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);

    // Update tabs using spread syntax
    tabsSetter({ ...tabsGetter(), [projectId]: newTabs });

    // Remove from tab order
    this.removeFromTabOrder(tabId);

    const currentActiveId = activeIdGetter()[projectId];
    if (currentActiveId === tabId) {
      let newActiveId: string | null = null;
      if (newTabs.length > 0) {
        const newIndex = Math.min(index, newTabs.length - 1);
        newActiveId = newTabs[newIndex]?.id || null;
      }
      activeIdSetter({ ...activeIdGetter(), [projectId]: newActiveId });
    }
  }

  /**
   * Add a tab ID to the ordering array and to the active pane.
   */
  add(tabId: string): void {
    if (!this.state.activeProjectId) return;
    const projectId = this.state.activeProjectId;
    const order = this.state.tabOrderByProject[projectId] ?? [];
    if (!order.includes(tabId)) {
      this.state.tabOrderByProject = {
        ...this.state.tabOrderByProject,
        [projectId]: [...order, tabId],
      };
    }
    this.paneManager?.addTabToActivePane(tabId);
  }

  /**
   * Remove a tab ID from the ordering array and from its pane.
   */
  removeFromTabOrder(tabId: string): void {
    if (!this.state.activeProjectId) return;
    const projectId = this.state.activeProjectId;
    const order = this.state.tabOrderByProject[projectId] ?? [];
    this.state.tabOrderByProject = {
      ...this.state.tabOrderByProject,
      [projectId]: order.filter((id: string) => id !== tabId),
    };
    this.paneManager?.removeTabFromPane(tabId);
  }

  /**
   * Reorder tabs to match the provided order array.
   */
  reorder(newOrder: string[]): void {
    if (!this.state.activeProjectId) return;
    this.state.tabOrderByProject = {
      ...this.state.tabOrderByProject,
      [this.state.activeProjectId]: newOrder,
    };
    this.schedulePersistence(this.state.activeProjectId);
  }

  /**
   * Get ordered tabs for a specific pane (filtered by pane's tabIds, preserving pane order).
   */
  orderedForPane(paneId: string): OrderedTabEntry[] {
    if (!this.state.activeProjectId) return [];

    const layout = this.state.paneLayoutByProject[this.state.activeProjectId];
    if (!layout) return this.ordered;

    const pane = layout.panes.find((p) => p.id === paneId);
    if (!pane) return [];

    const paneTabIdSet = new Set(pane.tabIds);
    const allTabs = this.ordered;

    // Filter to pane tabs and sort by pane order
    const paneTabs = allTabs.filter((t) => paneTabIdSet.has(t.id));
    return paneTabs.sort((a, b) => {
      return pane.tabIds.indexOf(a.id) - pane.tabIds.indexOf(b.id);
    });
  }

  /**
   * Extract timestamp from tab ID for default ordering.
   */
  private getTabTimestamp(id: string): number {
    const match = id.match(/\d+$/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Get all tabs ordered by user preference or creation time.
   */
  get ordered(): OrderedTabEntry[] {
    if (!this.state.activeProjectId) return [];

    // Ensure we have arrays (defensive against undefined)
    const queryTabs = this.state.queryTabs || [];
    const schemaTabs = this.state.schemaTabs || [];
    const explainTabs = this.state.explainTabs || [];
    const erdTabs = this.state.erdTabs || [];
    const statisticsTabs = this.state.statisticsTabs || [];
    const workflowTabs = this.state.workflowTabs || [];
    const visualizeTabs = this.state.visualizeTabs || [];

    const connectionTabs = this.state.connectionTabs || [];

    const dashboardTabs = this.state.dashboardTabs || [];

    const allTabsUnordered: OrderedTabEntry[] = [];

    for (const t of queryTabs) {
      allTabsUnordered.push({ id: t.id, type: "query", tab: t });
    }
    for (const t of schemaTabs) {
      allTabsUnordered.push({ id: t.id, type: "schema", tab: t });
    }
    for (const t of explainTabs) {
      allTabsUnordered.push({ id: t.id, type: "explain", tab: t });
    }
    for (const t of erdTabs) {
      allTabsUnordered.push({ id: t.id, type: "erd", tab: t });
    }
    for (const t of statisticsTabs) {
      allTabsUnordered.push({ id: t.id, type: "statistics", tab: t });
    }
    for (const t of workflowTabs) {
      allTabsUnordered.push({ id: t.id, type: "workflow", tab: t });
    }
    for (const t of visualizeTabs) {
      allTabsUnordered.push({ id: t.id, type: "visualize", tab: t });
    }
    for (const t of connectionTabs) {
      allTabsUnordered.push({ id: t.id, type: "connection", tab: t });
    }
    for (const t of dashboardTabs) {
      allTabsUnordered.push({ id: t.id, type: "dashboard", tab: t });
    }

    const starterTabs = this.state.starterTabs || [];

    for (const t of starterTabs) {
      allTabsUnordered.push({ id: t.id, type: "starter", tab: t });
    }

    const settingsTabs = this.state.settingsTabs || [];

    for (const t of settingsTabs) {
      allTabsUnordered.push({ id: t.id, type: "settings", tab: t });
    }

    const createTableTabs = this.state.createTableTabs || [];

    for (const t of createTableTabs) {
      allTabsUnordered.push({ id: t.id, type: "createTable", tab: t });
    }

    const dataTabs = this.state.dataTabs || [];

    for (const t of dataTabs) {
      allTabsUnordered.push({ id: t.id, type: "data", tab: t });
    }

    const extensionsDuckdbTabs = this.state.extensionsDuckdbTabs || [];

    for (const t of extensionsDuckdbTabs) {
      allTabsUnordered.push({ id: t.id, type: "extensionsDuckdb", tab: t });
    }

    const order = this.state.tabOrderByProject[this.state.activeProjectId] ?? [];

    // Sort by order array, falling back to timestamp for new tabs
    return allTabsUnordered.sort((a, b) => {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);

      // Both in order array: use order
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;

      // Only one in order: ordered comes first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      // Neither in order: fall back to timestamp
      return this.getTabTimestamp(a.id) - this.getTabTimestamp(b.id);
    });
  }
}
