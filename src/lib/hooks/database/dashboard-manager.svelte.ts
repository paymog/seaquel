import type { Dashboard, DashboardWidget } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import { getDatabase, dashboardsRepo } from "$lib/storage";
import type { PersistedDashboard } from "$lib/storage/repository";

/**
 * Manages dashboard CRUD operations, widget execution, and auto-refresh.
 * Dashboards are per-project.
 */
export class DashboardManager {
  private autoRefreshTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private state: DatabaseState,
    private executeQuery: (query: string) => Promise<Record<string, unknown>[]>,
    private scheduleProjectPersistence: (projectId: string | null) => void,
  ) {}

  // === CRUD ===

  async createDashboard(name: string): Promise<Dashboard | null> {
    const projectId = this.state.activeProjectId;
    if (!projectId) return null;

    const now = new Date();
    const dashboard: Dashboard = {
      id: `dashboard-${Date.now()}`,
      name,
      projectId,
      widgets: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      dateFilter: null,
      createdAt: now,
      updatedAt: now,
    };

    const dashboards = this.state.dashboardsByProject[projectId] ?? [];
    this.state.dashboardsByProject = {
      ...this.state.dashboardsByProject,
      [projectId]: [...dashboards, dashboard],
    };

    await this.persistDashboard(dashboard);
    return dashboard;
  }

  async deleteDashboard(id: string): Promise<void> {
    const projectId = this.state.activeProjectId;
    if (!projectId) return;

    // Stop any auto-refresh timers
    const dashboard = this.getDashboard(id);
    if (dashboard) {
      for (const widget of dashboard.widgets) {
        this.stopAutoRefresh(id, widget.id);
      }
    }

    const dashboards = this.state.dashboardsByProject[projectId] ?? [];
    this.state.dashboardsByProject = {
      ...this.state.dashboardsByProject,
      [projectId]: dashboards.filter((d) => d.id !== id),
    };

    try {
      const db = await getDatabase();
      await dashboardsRepo.remove(db, id);
    } catch (error) {
      console.error("Failed to delete dashboard:", error);
    }
  }

  async renameDashboard(id: string, name: string): Promise<void> {
    this.updateDashboard(id, (d) => ({ ...d, name, updatedAt: new Date() }));
    const dashboard = this.getDashboard(id);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  // === WIDGET MANAGEMENT ===

  async addWidget(dashboardId: string, widget: DashboardWidget): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: [...d.widgets, widget],
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  async updateWidget(
    dashboardId: string,
    widgetId: string,
    updates: Partial<DashboardWidget>,
  ): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...updates } : w)),
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  async removeWidget(dashboardId: string, widgetId: string): Promise<void> {
    this.stopAutoRefresh(dashboardId, widgetId);
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.filter((w) => w.id !== widgetId),
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  async moveWidget(
    dashboardId: string,
    widgetId: string,
    position: { x: number; y: number },
  ): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...position } : w)),
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  async resizeWidget(
    dashboardId: string,
    widgetId: string,
    size: { width: number; height: number },
  ): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...size } : w)),
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  // === VIEWPORT ===

  async updateViewport(
    dashboardId: string,
    viewport: { x: number; y: number; zoom: number },
  ): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      viewport,
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) await this.persistDashboard(dashboard);
  }

  // === WIDGET EXECUTION ===

  async executeWidget(dashboardId: string, widgetId: string): Promise<void> {
    const dashboard = this.getDashboard(dashboardId);
    if (!dashboard) return;

    const widget = dashboard.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    // Resolve query
    let query = widget.query;
    if (widget.querySource === "saved" && widget.savedQueryId) {
      const projectId = dashboard.projectId;
      const savedQueries = this.state.savedQueriesByProject[projectId] ?? [];
      const savedQuery = savedQueries.find((sq) => sq.id === widget.savedQueryId);
      if (savedQuery) {
        query = savedQuery.query;
      }
    }

    if (!query) return;

    // Inject date filter placeholders
    if (dashboard.dateFilter) {
      query = query
        .replace(/\{\{start_date\}\}/g, dashboard.dateFilter.start)
        .replace(/\{\{end_date\}\}/g, dashboard.dateFilter.end);
    }

    // Set loading state
    this.updateWidgetState(dashboardId, widgetId, { isLoading: true, error: undefined });

    try {
      const result = await this.executeQuery(query);
      this.updateWidgetState(dashboardId, widgetId, {
        result,
        isLoading: false,
        lastRefreshed: new Date(),
      });
    } catch (error) {
      this.updateWidgetState(dashboardId, widgetId, {
        isLoading: false,
        error: error instanceof Error ? error.message : "Query execution failed",
      });
    }
  }

  async executeAllWidgets(dashboardId: string): Promise<void> {
    const dashboard = this.getDashboard(dashboardId);
    if (!dashboard) return;

    await Promise.all(
      dashboard.widgets.map((widget) => this.executeWidget(dashboardId, widget.id)),
    );
  }

  // === AUTO-REFRESH ===

  startAutoRefresh(dashboardId: string, widgetId: string): void {
    const dashboard = this.getDashboard(dashboardId);
    if (!dashboard) return;

    const widget = dashboard.widgets.find((w) => w.id === widgetId);
    if (!widget?.autoRefreshSeconds || widget.autoRefreshSeconds <= 0) return;

    const timerKey = `${dashboardId}:${widgetId}`;
    this.stopAutoRefresh(dashboardId, widgetId);

    const timer = setInterval(() => {
      void this.executeWidget(dashboardId, widgetId);
    }, widget.autoRefreshSeconds * 1000);

    this.autoRefreshTimers.set(timerKey, timer);
  }

  stopAutoRefresh(dashboardId: string, widgetId: string): void {
    const timerKey = `${dashboardId}:${widgetId}`;
    const timer = this.autoRefreshTimers.get(timerKey);
    if (timer) {
      clearInterval(timer);
      this.autoRefreshTimers.delete(timerKey);
    }
  }

  stopAllAutoRefresh(): void {
    for (const timer of this.autoRefreshTimers.values()) {
      clearInterval(timer);
    }
    this.autoRefreshTimers.clear();
  }

  // === DATE FILTER ===

  async setDateFilter(
    dashboardId: string,
    range: { start: string; end: string } | null,
  ): Promise<void> {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      dateFilter: range,
      updatedAt: new Date(),
    }));
    const dashboard = this.getDashboard(dashboardId);
    if (dashboard) {
      await this.persistDashboard(dashboard);
      await this.executeAllWidgets(dashboardId);
    }
  }

  // === DATA LOADING ===

  async loadDashboards(projectId: string): Promise<void> {
    try {
      const db = await getDatabase();
      const rows = await dashboardsRepo.loadByProject(db, projectId);

      const dashboards: Dashboard[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        projectId: r.projectId,
        widgets: JSON.parse(r.widgets),
        viewport: JSON.parse(r.viewport),
        dateFilter: r.dateFilter ? JSON.parse(r.dateFilter) : null,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
      }));

      this.state.dashboardsByProject = {
        ...this.state.dashboardsByProject,
        [projectId]: dashboards,
      };
    } catch (error) {
      console.error("Failed to load dashboards:", error);
    }
  }

  // === HELPERS ===

  getDashboard(id: string): Dashboard | undefined {
    for (const dashboards of Object.values(this.state.dashboardsByProject)) {
      const found = dashboards.find((d) => d.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private updateDashboard(id: string, updater: (d: Dashboard) => Dashboard): void {
    for (const [projectId, dashboards] of Object.entries(this.state.dashboardsByProject)) {
      const index = dashboards.findIndex((d) => d.id === id);
      if (index !== -1) {
        const updated = [...dashboards];
        updated[index] = updater(updated[index]);
        this.state.dashboardsByProject = {
          ...this.state.dashboardsByProject,
          [projectId]: updated,
        };
        return;
      }
    }
  }

  private updateWidgetState(
    dashboardId: string,
    widgetId: string,
    updates: Partial<DashboardWidget>,
  ): void {
    this.updateDashboard(dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...updates } : w)),
    }));
  }

  private async persistDashboard(dashboard: Dashboard): Promise<void> {
    try {
      const db = await getDatabase();
      // Strip runtime state from widgets before persisting
      const widgetsForStorage = dashboard.widgets.map(
        ({ result: _, isLoading: __, error: ___, lastRefreshed: ____, ...rest }) => rest,
      );

      const persisted: PersistedDashboard = {
        id: dashboard.id,
        projectId: dashboard.projectId,
        name: dashboard.name,
        viewport: JSON.stringify(dashboard.viewport),
        widgets: JSON.stringify(widgetsForStorage),
        dateFilter: dashboard.dateFilter ? JSON.stringify(dashboard.dateFilter) : null,
        createdAt: dashboard.createdAt.toISOString(),
        updatedAt: dashboard.updatedAt.toISOString(),
      };

      await dashboardsRepo.save(db, persisted);
    } catch (error) {
      console.error("Failed to persist dashboard:", error);
    }
  }
}
