import type { DashboardTab } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";

/**
 * Manages Dashboard tabs.
 * Tabs are organized per-project.
 */
export class DashboardTabManager extends BaseTabManager<DashboardTab> {
  private setActiveView: (
    view:
      | "query"
      | "schema"
      | "explain"
      | "erd"
      | "statistics"
      | "canvas"
      | "visualize"
      | "connection"
      | "dashboard",
  ) => void;

  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (
      view:
        | "query"
        | "schema"
        | "explain"
        | "erd"
        | "statistics"
        | "canvas"
        | "visualize"
        | "connection"
        | "dashboard",
    ) => void,
  ) {
    super(state, tabOrdering, schedulePersistence);
    this.setActiveView = setActiveView;
  }

  protected get accessors(): TabStateAccessors<DashboardTab> {
    return {
      getTabs: () => this.state.dashboardTabsByProject,
      setTabs: (r) => (this.state.dashboardTabsByProject = r),
      getActiveId: () => this.state.activeDashboardTabIdByProject,
      setActiveId: (r) => (this.state.activeDashboardTabIdByProject = r),
    };
  }

  /**
   * Open a dashboard tab. If a tab for this dashboard already exists, focus it.
   * If no dashboardId is provided, creates a new dashboard first.
   */
  add(dashboardId?: string, dashboardName?: string): string | null {
    if (!this.state.activeProjectId) return null;

    // Check if a tab already exists for this dashboard
    if (dashboardId) {
      const tabs = this.getProjectTabs();
      const existingTab = tabs.find((t) => t.dashboardId === dashboardId);
      if (existingTab) {
        this.setActiveTabId(existingTab.id);
        this.setActiveView("dashboard");
        return existingTab.id;
      }
    }

    const newTab: DashboardTab = {
      id: `dash-${crypto.randomUUID()}`,
      name: dashboardName ?? "New Dashboard",
      dashboardId: dashboardId ?? "",
    };

    this.appendTab(newTab);
    this.setActiveView("dashboard");

    return newTab.id;
  }

  /**
   * Remove a dashboard tab. If none left, switch back to query view.
   */
  override remove(id: string): void {
    super.remove(id);

    const remainingTabs = this.state.dashboardTabsByProject[this.state.activeProjectId!] ?? [];
    if (remainingTabs.length === 0) {
      this.setActiveView("query");
    }
  }

  /**
   * Update the dashboardId on a tab (used when creating a new dashboard).
   */
  setDashboardId(tabId: string, dashboardId: string): void {
    this.updateTab(tabId, (t) => ({ ...t, dashboardId }));
    this.schedulePersistence(this.state.activeProjectId);
  }

  /**
   * Rename a dashboard tab.
   */
  rename(tabId: string, name: string): void {
    this.updateTab(tabId, (t) => ({ ...t, name }));
    this.schedulePersistence(this.state.activeProjectId);
  }
}
