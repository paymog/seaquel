import type { ActiveViewType } from "$lib/types/persisted";
import type { WorkflowTab } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";

/**
 * Manages workflow tabs.
 * Tabs are organized per-project.
 */
export class WorkflowTabManager extends BaseTabManager<WorkflowTab> {
  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    schedulePersistence: (projectId: string | null) => void,
    setActiveView: (view: ActiveViewType) => void,
  ) {
    super(state, tabOrdering, schedulePersistence, setActiveView);
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
      this.setActive(existingTab.id);
      this.viewFallbackFn!("workflow");
      return existingTab.id;
    }

    const newWorkflowTab: WorkflowTab = {
      id: `workflow-${crypto.randomUUID()}`,
      name: `Workflows: ${this.state.activeConnection.name}`,
      connectionId: this.state.activeConnectionId,
    };

    this.appendTab(newWorkflowTab);
    this.viewFallbackFn!("workflow");

    return newWorkflowTab.id;
  }
}
