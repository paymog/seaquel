import type { SettingsTab, SettingsTabKind, ActiveViewType } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";

const SETTINGS_TAB_ID = "settings-app";
const PROJECT_SETTINGS_TAB_ID = "settings-project";

/**
 * Manages settings tabs (app settings and project settings).
 * These are singleton-like tabs — only one of each kind can exist at a time.
 */
export class SettingsTabManager extends BaseTabManager<SettingsTab> {
  private setActiveView: (view: ActiveViewType) => void;
  private previousView: ActiveViewType | null = null;

  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (view: ActiveViewType) => void,
  ) {
    super(state, tabOrdering, schedulePersistence);
    this.setActiveView = setActiveView;
  }

  protected get accessors(): TabStateAccessors<SettingsTab> {
    return {
      getTabs: () => this.state.settingsTabsByProject,
      setTabs: (r) => (this.state.settingsTabsByProject = r),
      getActiveId: () => this.state.activeSettingsTabIdByProject,
      setActiveId: (r) => (this.state.activeSettingsTabIdByProject = r),
    };
  }

  /**
   * Open a settings tab. If one of the same kind already exists, focus it.
   */
  open(kind: SettingsTabKind = "app", activeView?: string): string | null {
    if (!this.state.activeProjectId) return null;

    const id = kind === "app" ? SETTINGS_TAB_ID : PROJECT_SETTINGS_TAB_ID;
    const existing = this.getProjectTabs();

    // If tab already exists, just focus it
    const found = existing.find((t) => t.id === id);
    if (found) {
      // Update activeView if provided
      if (activeView !== undefined) {
        this.updateTab(id, (t) => ({ ...t, activeView }));
      }
      this.setActive(id);
      this.setActiveView("settings");
      return id;
    }

    const name = kind === "app" ? "Settings" : "Project Settings";

    const newTab: SettingsTab = {
      id,
      name,
      kind,
      activeView: activeView ?? "all",
    };

    this.appendTab(newTab);
    if (this.previousView === null) {
      this.previousView = this.state.activeView;
    }
    this.setActiveView("settings");

    return newTab.id;
  }

  /**
   * Add a settings tab (BaseTabManager compatibility).
   */
  add(): string | null {
    return this.open("app");
  }

  /**
   * Update the active section/view within a settings tab.
   */
  setSettingsView(tabId: string, view: string): void {
    this.updateTab(tabId, (t) => ({ ...t, activeView: view }));
  }

  /**
   * Remove a settings tab by ID.
   */
  override remove(id: string): void {
    super.remove(id);

    const remainingTabs = this.state.settingsTabsByProject[this.state.activeProjectId!] ?? [];
    if (remainingTabs.length === 0) {
      const restoreView = this.previousView ?? "query";
      this.previousView = null;
      this.setActiveView(restoreView);
    }
  }
}
