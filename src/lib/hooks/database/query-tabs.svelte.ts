import type { QueryTab, ExplainResult, ParsedQueryVisual, QueryHistoryItem } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { TabOrderingManager } from "./tab-ordering.svelte.js";
import type { ConnectionManager } from "./connection-manager.svelte.js";
import { BaseTabManager, type TabStateAccessors } from "./base-tab-manager.svelte.js";
import { saveQueryWorkspace } from "$lib/utils/query-workspace-storage.js";

/**
 * Manages query tabs: add, remove, rename, update content.
 * Tabs are personal workspace state (localStorage), not shared project persistence.
 */
export class QueryTabManager extends BaseTabManager<QueryTab> {
  private connections: ConnectionManager | null = null;

  constructor(
    state: DatabaseState,
    tabOrdering: TabOrderingManager,
    _scheduleProjectPersistence: (projectId: string | null) => void,
  ) {
    super(state, tabOrdering, () => {});
  }

  setConnectionManager(manager: ConnectionManager): void {
    this.connections = manager;
  }

  protected get accessors(): TabStateAccessors<QueryTab> {
    return {
      getTabs: () => this.state.queryTabsByProject,
      setTabs: (r) => (this.state.queryTabsByProject = r),
      getActiveId: () => this.state.activeQueryTabIdByProject,
      setActiveId: (r) => (this.state.activeQueryTabIdByProject = r),
    };
  }

  persistWorkspace(projectId?: string | null): void {
    const id = projectId ?? this.state.activeProjectId;
    if (!id) return;
    const tabs = this.state.queryTabsByProject[id] ?? [];
    saveQueryWorkspace(id, {
      tabs: tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        query: tab.query,
        queryId: tab.queryId,
        connectionId: tab.connectionId,
      })),
      activeTabId: this.state.activeQueryTabIdByProject[id] ?? null,
    });
  }

  /** @deprecated Query tabs no longer use shared project persistence */
  private scheduleLocalPersistence(): void {
    this.persistWorkspace();
  }

  remove(id: string): void {
    super.remove(id);
    this.persistWorkspace();
  }

  setActive(id: string): void {
    super.setActive(id);
    const tab = this.getProjectTabs().find((t) => t.id === id);
    if (tab?.connectionId && this.connections) {
      this.connections.setActive(tab.connectionId);
    }
    this.persistWorkspace();
  }

  assignConnection(tabId: string, connectionId: string): void {
    if (!this.state.activeProjectId) return;
    const tabs = this.getProjectTabs();
    if (!tabs.some((t) => t.id === tabId)) return;
    this.updateTab(tabId, (t) => ({ ...t, connectionId }));
    this.persistWorkspace();
  }

  getTabConnection(tab: QueryTab | null | undefined) {
    if (!tab?.connectionId) return null;
    return this.state.connections.find((c) => c.id === tab.connectionId) ?? null;
  }

  /**
   * Add a new query tab, bound to the active connection when available.
   */
  add(name?: string, query?: string, queryId?: string, connectionId?: string): string | null {
    if (!this.state.activeProjectId) return null;

    const tabs = this.getProjectTabs();
    const boundConnectionId = connectionId ?? this.state.activeConnectionId ?? undefined;
    const newTab: QueryTab = $state({
      id: `tab-${crypto.randomUUID()}`,
      name: name || `Query ${tabs.length + 1}`,
      query: query || "",
      isExecuting: false,
      queryId,
      connectionId: boundConnectionId,
    });

    const tabId = this.appendTab(newTab);
    this.persistWorkspace();
    return tabId;
  }

  /** Rename is local-only; never mutates linked saved/shared queries. */
  rename(id: string, newName: string): void {
    if (!this.state.activeProjectId) return;
    const tab = this.getProjectTabs().find((t) => t.id === id);
    if (!tab || tab.name === newName) return;
    this.updateTab(id, (t) => ({ ...t, name: newName }));
    this.persistWorkspace();
  }

  hasUnsavedChanges(tabId: string): boolean {
    const tab = this.state.queryTabs.find((t) => t.id === tabId);
    if (!tab) return false;

    if (!tab.query.trim()) return false;

    if (tab.queryId) {
      const query = this.state.projectQueries.find((q) => q.id === tab.queryId);
      if (!query) return true;
      return tab.query !== query.query;
    }

    return true;
  }

  updateContent(id: string, query: string): void {
    if (!this.state.activeProjectId) return;

    const tabs = this.getProjectTabs();
    const tab = tabs.find((t) => t.id === id);
    if (tab && tab.query !== query) {
      this.updateTab(id, (t) => ({ ...t, query }));
      this.persistWorkspace();
    }
  }

  focusOrCreate(query: string, name?: string, setActiveView?: () => void): string | null {
    if (!this.state.activeProjectId) return null;

    const tabs = this.getProjectTabs();
    const existingTab = tabs.find((t) => t.query.trim() === query.trim());

    if (existingTab) {
      this.setActive(existingTab.id);
      setActiveView?.();
      return existingTab.id;
    }

    const newTabId = this.add(name, query);
    setActiveView?.();
    return newTabId;
  }

  loadQuery(queryId: string, setActiveView?: () => void): void {
    if (!this.state.activeProjectId) return;

    const queries = this.state.queriesByProject[this.state.activeProjectId] ?? [];
    const query = queries.find((q) => q.id === queryId);
    if (!query) return;

    const tabs = this.getProjectTabs();
    const existingTab = tabs.find((t) => t.queryId === queryId);

    if (existingTab) {
      this.setActive(existingTab.id);
      setActiveView?.();
    } else {
      this.add(query.name, query.query, queryId, this.state.activeConnectionId ?? undefined);
      setActiveView?.();
    }
  }

  /** @deprecated Use loadQuery instead */
  loadSaved(queryId: string, setActiveView?: () => void): void {
    this.loadQuery(queryId, setActiveView);
  }

  /** @deprecated Use loadQuery instead */
  loadSharedQuery(
    queryId: string,
    _name: string,
    _query: string,
    setActiveView?: () => void,
  ): void {
    this.loadQuery(queryId, setActiveView);
  }

  private findHistoryItem(historyId: string): QueryHistoryItem | undefined {
    for (const history of Object.values(this.state.queryHistoryByConnection)) {
      const item = history.find((h) => h.id === historyId);
      if (item) return item;
    }
    return undefined;
  }

  loadFromHistory(historyId: string, setActiveView?: () => void): void {
    if (!this.state.activeProjectId) return;

    const item = this.findHistoryItem(historyId);
    if (!item) return;

    const tabs = this.getProjectTabs();
    const existingTab = tabs.find((t) => t.query.trim() === item.query.trim());

    if (existingTab) {
      this.setActive(existingTab.id);
      setActiveView?.();
    } else {
      this.add(
        `History: ${item.query.substring(0, 20)}...`,
        item.query,
        undefined,
        item.connectionId,
      );
      setActiveView?.();
    }
  }

  setExplainResult(
    tabId: string,
    result: ExplainResult,
    sourceQuery: string,
    isAnalyze: boolean,
  ): void {
    if (!this.state.activeProjectId) return;

    this.updateTab(tabId, (t) => ({
      ...t,
      explainResult: { result, sourceQuery, isAnalyze, isExecuting: false },
    }));
  }

  setExplainExecuting(tabId: string, isExecuting: boolean, isAnalyze: boolean = false): void {
    if (!this.state.activeProjectId) return;

    this.updateTab(tabId, (t) => ({
      ...t,
      explainResult: t.explainResult
        ? { ...t.explainResult, isExecuting }
        : {
            result: undefined as unknown as ExplainResult,
            sourceQuery: "",
            isAnalyze,
            isExecuting,
          },
    }));
  }

  clearExplainResult(tabId: string): void {
    if (!this.state.activeProjectId) return;
    this.updateTab(tabId, (t) => ({ ...t, explainResult: undefined }));
  }

  setVisualizeResult(
    tabId: string,
    parsedQuery: ParsedQueryVisual | null,
    sourceQuery: string,
    parseError?: string,
  ): void {
    if (!this.state.activeProjectId) return;

    this.updateTab(tabId, (t) => ({
      ...t,
      visualizeResult: { parsedQuery, sourceQuery, parseError },
    }));
  }

  clearVisualizeResult(tabId: string): void {
    if (!this.state.activeProjectId) return;
    this.updateTab(tabId, (t) => ({ ...t, visualizeResult: undefined }));
  }
}
