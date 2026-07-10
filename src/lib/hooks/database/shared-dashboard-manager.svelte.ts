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
import { writeTextFile, remove, mkdir, exists, join, dirname } from "$lib/utils/tauri-fs";

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

  /**
   * Write a dashboard as a .json file in the git repo.
   */
  async writeDashboardFile(dashboard: Dashboard): Promise<void> {
    const repoId = this.state.activeRepoId;
    if (!repoId) return;

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return;

    const dashboardsBase = this.getDashboardsBasePath();
    if (!dashboardsBase) return;

    const filename = dashboardNameToFilename(dashboard.name);
    const filePath = `${dashboardsBase}/${filename}`;

    const content = serializeDashboardFile(dashboard);
    const fullPath = await join(repo.path, filePath);
    const folderPath = await dirname(fullPath);

    if (!(await exists(folderPath))) {
      await mkdir(folderPath, { recursive: true });
    }

    await writeTextFile(fullPath, content);
    await this.repoManager.refreshRepoStatus(repoId);
  }

  /**
   * Delete the .json file for a dashboard from the git repo.
   */
  async deleteDashboardFile(dashboard: Dashboard): Promise<void> {
    const repoId = this.state.activeRepoId;
    if (!repoId) return;

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return;

    const dashboardsBase = this.getDashboardsBasePath();
    if (!dashboardsBase) return;

    const filename = dashboardNameToFilename(dashboard.name);
    const filePath = `${dashboardsBase}/${filename}`;
    const fullPath = await join(repo.path, filePath);

    try {
      await remove(fullPath);
    } catch {
      // File may not exist
    }

    await this.repoManager.refreshRepoStatus(repoId);
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

  /**
   * Reconcile .json files from the scan cache with SQLite dashboards.
   * - New .json files → create Dashboard with shared=true
   * - Missing .json files for shared dashboards → set shared=false
   * - Updated .json files → update dashboard content
   * Returns the list of dashboards after reconciliation.
   */
  reconcileWithGitFiles(projectId: string, dashboards: Dashboard[]): Dashboard[] {
    const repoId = this.state.activeRepoId;
    if (!repoId) return dashboards;

    const dashboardsBase = this.getDashboardsBasePath();
    if (!dashboardsBase) return dashboards;

    const allScannedDashboards = this.state.sharedDashboardsByRepo[repoId] ?? [];
    const gitDashboards = allScannedDashboards.filter((d) =>
      d.filePath?.startsWith(dashboardsBase + "/"),
    );

    const result = [...dashboards];
    const matchedGitNames = new Set<string>();

    // Match existing shared dashboards to git files by name
    for (const gitDashboard of gitDashboards) {
      const matchKey = gitDashboard.name.toLowerCase();
      const existingIdx = result.findIndex((d) => d.shared && d.name.toLowerCase() === matchKey);

      const updatedAt =
        gitDashboard.updatedAt instanceof Date
          ? gitDashboard.updatedAt
          : gitDashboard.updatedAt
            ? new Date(gitDashboard.updatedAt)
            : new Date();

      if (existingIdx !== -1) {
        // Update content if git file is newer
        const existing = result[existingIdx];
        result[existingIdx] = {
          ...existing,
          widgets: gitDashboard.widgets,
          viewport: gitDashboard.viewport,
          description: gitDashboard.description,
          dateFilter: gitDashboard.dateFilter,
          updatedAt,
        };
        matchedGitNames.add(matchKey);
      } else {
        // New .json file → create a new shared Dashboard
        const newDashboard: Dashboard = {
          id: `dashboard-${crypto.randomUUID()}`,
          name: gitDashboard.name,
          projectId,
          widgets: gitDashboard.widgets,
          viewport: gitDashboard.viewport,
          dateFilter: gitDashboard.dateFilter,
          createdAt: new Date(),
          updatedAt,
          shared: true,
          starred: false,
          description: gitDashboard.description,
        };
        result.push(newDashboard);
        matchedGitNames.add(matchKey);
      }
    }

    // Shared dashboards in SQLite with no matching .json file → mark as unshared
    for (let i = 0; i < result.length; i++) {
      const d = result[i];
      if (d.shared) {
        const matchKey = d.name.toLowerCase();
        if (!matchedGitNames.has(matchKey)) {
          result[i] = { ...d, shared: false };
        }
      }
    }

    return result;
  }
}
