import { describe, expect, it } from "vitest";
import { DatabaseState } from "./state.svelte";
import { PaneManager } from "./pane-manager.svelte";
import { PendingChangesManager } from "./pending-changes.svelte";
import type { ProviderRegistry } from "$lib/providers";
import type { QueryHistoryManager } from "./query-history.svelte";

function setup() {
  const state = new DatabaseState();
  state.activeProjectId = "project";
  state.activeConnectionIdByProject = { project: "graph" };
  state.queryTabsByProject = {
    project: [
      {
        id: "graph-tab",
        name: "Graph",
        query: "select 1",
        isExecuting: false,
        connectionId: "graph",
      },
      {
        id: "maestro-tab",
        name: "Maestro",
        query: "update users set enabled = true",
        isExecuting: false,
        connectionId: "maestro",
      },
      { id: "legacy-tab", name: "Legacy", query: "select 1", isExecuting: false },
    ],
  };
  state.paneLayoutByProject = {
    project: {
      activePaneId: "graph-pane",
      panes: [
        { id: "graph-pane", tabIds: ["graph-tab"], activeTabId: "graph-tab" },
        { id: "maestro-pane", tabIds: ["maestro-tab", "legacy-tab"], activeTabId: "maestro-tab" },
      ],
    },
  };
  const panes = new PaneManager(
    state,
    () => {},
    (connectionId) => {
      state.activeConnectionIdByProject = { project: connectionId };
    },
  );
  const pending = new PendingChangesManager(
    state,
    {} as ProviderRegistry,
    {} as QueryHistoryManager,
  );
  pending.add(
    "maestro",
    "update users set enabled = true",
    "update",
    "query-editor",
    "maestro-tab",
  );
  return { state, panes };
}

describe("pane query connection selection", () => {
  it("shows the focused query's pending writes instead of the other pane's database", () => {
    const { state, panes } = setup();
    panes.setActivePane("maestro-pane");
    expect(state.activeQueryTabId).toBe("maestro-tab");
    expect(state.activeConnectionId).toBe("maestro");
    expect(state.activePendingChanges.map((change) => change.sql)).toEqual([
      "update users set enabled = true",
    ]);
    panes.setActivePane("graph-pane");
    expect(state.activeConnectionId).toBe("graph");
    expect(state.activePendingChanges).toEqual([]);
  });

  it("activates a bound tab's database without assigning a legacy tab", () => {
    const { state, panes } = setup();
    panes.setActiveTab("maestro-pane", "maestro-tab");
    expect(state.activeConnectionId).toBe("maestro");
    panes.setActiveTab("maestro-pane", "legacy-tab");
    expect(state.queryTabs.find((tab) => tab.id === "legacy-tab")?.connectionId).toBeUndefined();
    expect(state.activeConnectionId).toBe("maestro");
  });
});
