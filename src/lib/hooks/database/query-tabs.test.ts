import { describe, expect, it } from "vitest";
import { DatabaseState } from "./state.svelte";
import { QueryTabManager } from "./query-tabs.svelte";
import type { TabOrderingManager } from "./tab-ordering.svelte";

function setup(connectionId?: string) {
  const state = new DatabaseState();
  state.activeProjectId = "project";
  state.queryTabsByProject = {
    project: [{ id: "tab", name: "Query", query: "select 1", isExecuting: false, connectionId }],
  };
  return { state, tabs: new QueryTabManager(state, {} as TabOrderingManager, () => {}) };
}

describe("query tab connection binding", () => {
  it("does not change a bound tab to another connection", () => {
    const { state, tabs } = setup("first");
    tabs.assignConnection("tab", "second");
    expect(state.queryTabsByProject.project[0].connectionId).toBe("first");
  });

  it("lets a legacy unassigned tab bind once, then keeps that connection", () => {
    const { state, tabs } = setup();
    tabs.assignConnection("tab", "first");
    tabs.assignConnection("tab", "second");
    expect(state.queryTabsByProject.project[0].connectionId).toBe("first");
  });
});
