import type { WorkflowTab } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";

/**
 * Manages workflow tabs.
 * Tabs are organized per-project.
 */
export class WorkflowTabManager extends BaseTabManager<WorkflowTab> {
  private setActiveView: (
    view: "query" | "schema" | "explain" | "erd" | "statistics" | "workflow",
  ) => void;

  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (
      view: "query" | "schema" | "explain" | "erd" | "statistics" | "workflow",
    ) => void,
  ) {
    super(state, tabOrdering, schedulePersistence);
    this.setActiveView = setActiveView;
  }

  protected get accessors(): TabStateAccessors<WorkflowTab> {
    return {
      getTabs: () => this.state.workflowTabsByProject,
      setTabs: (r) => (this.state.workflowTabsByProject = r),
      getActiveId: () => this.state.activeWorkflowTabIdByProject,
      setActiveId: (r) => (this.state.activeWorkflowTabIdByProject = r),
    };
  }

  /**
   * Add a workflow tab for the current connection.
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

    // Check if a workflow tab already exists for this connection
    const existingTab = tabs.find((t) => t.connectionId === this.state.activeConnectionId);
    if (existingTab) {
      // Just switch to the existing tab
      this.setActiveTabId(existingTab.id);
      this.setActiveView("workflow");
      return existingTab.id;
    }

    const newWorkflowTab: WorkflowTab = {
      id: `workflow-${crypto.randomUUID()}`,
      name: `Workflows: ${this.state.activeConnection.name}`,
      connectionId: this.state.activeConnectionId,
    };

    this.appendTab(newWorkflowTab);
    this.setActiveView("workflow");

    return newWorkflowTab.id;
  }

  /**
   * Remove a workflow tab by ID.
   */
  override remove(id: string): void {
    super.remove(id);

    // If no more workflow tabs, switch back to query view
    const remainingTabs = this.state.workflowTabsByProject[this.state.activeProjectId!] ?? [];
    if (remainingTabs.length === 0) {
      this.setActiveView("query");
    }
  }
}
