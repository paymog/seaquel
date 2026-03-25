import type { ActiveViewType } from "$lib/types/persisted";
import type { ErdTab } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";

/**
 * Manages ERD (Entity Relationship Diagram) tabs.
 * Tabs are organized per-project.
 */
export class ErdTabManager extends BaseTabManager<ErdTab> {
  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (view: ActiveViewType) => void,
  ) {
    super(state, tabOrdering, schedulePersistence, setActiveView);
  }

  protected get accessors(): TabStateAccessors<ErdTab> {
    return {
      getTabs: () => this.state.erdTabsByProject,
      setTabs: (r) => (this.state.erdTabsByProject = r),
      getActiveId: () => this.state.activeErdTabIdByProject,
      setActiveId: (r) => (this.state.activeErdTabIdByProject = r),
    };
  }

  /**
   * Add an ERD tab for the current connection.
   * Returns the tab ID or null if no active project/connection.
   */
  add(): string | null {
    if (
      !this.state.activeProjectId ||
      !this.state.activeConnectionId ||
      !this.state.activeConnection
    )
      return null;

    const tabs = this.getProjectTabs();

    // Check if an ERD tab already exists for this connection
    const existingTab = tabs.find((t) => t.name === `ERD: ${this.state.activeConnection!.name}`);
    if (existingTab) {
      // Just switch to the existing tab
      this.setActiveTabId(existingTab.id);
      this.viewFallbackFn!("erd");
      return existingTab.id;
    }

    const newErdTab: ErdTab = {
      id: `erd-${crypto.randomUUID()}`,
      name: `ERD: ${this.state.activeConnection.name}`,
      connectionId: this.state.activeConnectionId,
    };

    this.appendTab(newErdTab);
    this.viewFallbackFn!("erd");

    return newErdTab.id;
  }
}
