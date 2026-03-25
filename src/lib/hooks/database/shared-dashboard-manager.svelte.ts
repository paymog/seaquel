import type { SharedDashboard, Dashboard } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import {
  SEAQUEL_DIR,
  parseCompositeId,
  type SharedRepoManager,
} from "./shared-repo-manager.svelte.js";
import { stripWidgetRuntimeState } from "./dashboard-manager.svelte.js";
import {
  serializeDashboardFile,
  dashboardNameToFilename,
} from "$lib/services/dashboard-file-parser";
import { nameToFilename } from "$lib/services/config-file-parser";
import { writeTextFile, remove, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";

export class SharedDashboardManager {
  constructor(
    private state: DatabaseState,
    private repoManager: SharedRepoManager,
  ) {}

  private getDashboardsBasePath(): string | null {
    const project = this.state.projects.find((p) => p.id === this.state.activeProjectId);
    if (!project) return null;
    const dirName = nameToFilename(project.name);
    return `${SEAQUEL_DIR}/projects/${dirName}/dashboards`;
  }

  async createDashboard(
    name: string,
    widgets: Dashboard["widgets"],
    viewport: Dashboard["viewport"],
    options?: {
      description?: string;
      dateFilter?: Dashboard["dateFilter"];
    },
  ): Promise<string | null> {
    const repoId = this.state.activeRepoId;
    if (!repoId) return null;

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return null;

    const dashboardsBase = this.getDashboardsBasePath();
    if (!dashboardsBase) return null;

    const filename = dashboardNameToFilename(name);
    const filePath = `${dashboardsBase}/${filename}`;

    const sharedDashboard: SharedDashboard = {
      id: `${repoId}:${filePath}`,
      repoId,
      filePath,
      name,
      description: options?.description,
      widgets,
      viewport,
      dateFilter: options?.dateFilter ?? null,
      updatedAt: new Date(),
    };

    const content = serializeDashboardFile(sharedDashboard);
    const fullPath = await join(repo.path, filePath);
    const folderPath = await dirname(fullPath);

    if (!(await exists(folderPath))) {
      await mkdir(folderPath, { recursive: true });
    }

    await writeTextFile(fullPath, content);

    const dashboards = this.state.sharedDashboardsByRepo[repoId] ?? [];
    this.state.sharedDashboardsByRepo = {
      ...this.state.sharedDashboardsByRepo,
      [repoId]: [...dashboards, sharedDashboard],
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return sharedDashboard.id;
  }

  async deleteDashboard(dashboardId: string): Promise<boolean> {
    const { repoId, filePath } = parseCompositeId(dashboardId);

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return false;

    const dashboards = this.state.sharedDashboardsByRepo[repoId] ?? [];
    const dashboard = dashboards.find((d) => d.id === dashboardId);
    if (!dashboard) return false;

    const fullPath = await join(repo.path, filePath);
    await remove(fullPath);

    this.state.sharedDashboardsByRepo = {
      ...this.state.sharedDashboardsByRepo,
      [repoId]: dashboards.filter((d) => d.id !== dashboardId),
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return true;
  }

  getDashboard(dashboardId: string): SharedDashboard | null {
    const { repoId } = parseCompositeId(dashboardId);
    const dashboards = this.state.sharedDashboardsByRepo[repoId] ?? [];
    return dashboards.find((d) => d.id === dashboardId) ?? null;
  }

  async shareDashboard(dashboard: Dashboard): Promise<string | null> {
    // Strip runtime state from widgets
    const widgets = dashboard.widgets.map(stripWidgetRuntimeState);
    return this.createDashboard(dashboard.name, widgets, dashboard.viewport, {
      dateFilter: dashboard.dateFilter,
    });
  }

  async unshareDashboard(dashboardId: string): Promise<boolean> {
    return this.deleteDashboard(dashboardId);
  }
}
