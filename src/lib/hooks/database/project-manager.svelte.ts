import type { Project, ConnectionLabel, PersistedProject, DatabaseConnection } from "$lib/types";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { PersistenceManager } from "./persistence-manager.svelte.js";
import { SEAQUEL_DIR, type SharedRepoManager } from "./shared-repo-manager.svelte.js";
import { MigrationManager } from "./migration.svelte.js";
import { isTauri } from "$lib/utils/environment";
import {
  mkdir,
  remove as removeDir,
  rename as renameFs,
  exists,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { nameToFilename, serializeProjectFile } from "$lib/services/config-file-parser";

/**
 * Manages projects and their lifecycle.
 * Projects group connections and provide organization.
 */
export class ProjectManager {
  private migration: MigrationManager;
  private removeConnection: ((connectionId: string) => Promise<void>) | null = null;
  private initializeStarterTabs: ((projectId: string) => void) | null = null;
  private sharedRepos: SharedRepoManager | null = null;

  constructor(
    private state: DatabaseState,
    private persistence: PersistenceManager,
  ) {
    this.migration = new MigrationManager(persistence);
  }

  /**
   * Set the shared repo manager reference.
   * Called by the main database class after SharedRepoManager is created.
   */
  setSharedRepoManager(manager: SharedRepoManager): void {
    this.sharedRepos = manager;
  }

  /**
   * Set the callback for removing connections.
   * This is called by the main database class after ConnectionManager is created.
   */
  setRemoveConnectionCallback(callback: (connectionId: string) => Promise<void>): void {
    this.removeConnection = callback;
  }

  /**
   * Set the callback for initializing starter tabs.
   * This is called by the main database class after StarterTabManager is created.
   */
  setInitializeStarterTabsCallback(callback: (projectId: string) => void): void {
    this.initializeStarterTabs = callback;
  }

  /**
   * Initialize projects on app startup.
   * Runs migrations if needed and loads projects.
   */
  async initialize(): Promise<void> {
    // Run migrations first
    await this.migration.migrateIfNeeded();

    // Load projects
    const persistedProjects = await this.persistence.loadProjects();

    if (persistedProjects.length === 0) {
      // Create default project
      const defaultProject = this.createDefaultProject();
      this.state.projects = [defaultProject];
      await this.persistence.persistProjects();
    } else {
      // Deserialize projects
      this.state.projects = persistedProjects.map((p) => this.deserializeProject(p));
    }

    // Set active project
    const lastActiveProjectId = await this.persistence.getLastActiveProjectId();
    const validProjectId = this.state.projects.find((p) => p.id === lastActiveProjectId)?.id;
    this.state.activeProjectId = validProjectId || this.state.projects[0]?.id || null;

    // Load project state if there's an active project
    if (this.state.activeProjectId) {
      await this.loadProjectState(this.state.activeProjectId);
    }

    this.state.projectsLoading = false;
  }

  /**
   * Create a new project.
   * The newly created project is automatically set as active.
   */
  async add(name: string, description?: string): Promise<Project> {
    const now = new Date();
    const project: Project = {
      id: `project-${Date.now()}`,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      customLabels: [],
    };

    this.state.projects = [...this.state.projects, project];
    await this.persistence.persistProjects();

    // Automatically make the new project active
    await this.setActive(project.id);

    return project;
  }

  /**
   * Update an existing project.
   */
  async update(
    id: string,
    updates: Partial<Pick<Project, "name" | "description" | "gitRepoPath">>,
  ): Promise<void> {
    const project = this.state.projects.find((p) => p.id === id);

    // Rename git repo project directory and update project.yaml if the name changed
    if (updates.name && project && project.name !== updates.name && project.gitRepoPath) {
      const repo = this.state.sharedRepos.find((r) => r.path === project.gitRepoPath);
      if (repo) {
        try {
          const oldDirName = nameToFilename(project.name);
          const newDirName = nameToFilename(updates.name);
          const projectsDir = await join(repo.path, SEAQUEL_DIR, "projects");
          const oldDir = await join(projectsDir, oldDirName);

          if (await exists(oldDir)) {
            // Rename directory if the filename changed
            const targetDir =
              oldDirName !== newDirName ? await join(projectsDir, newDirName) : oldDir;
            if (oldDirName !== newDirName) {
              await renameFs(oldDir, targetDir);
            }

            // Update name in project.yaml
            const projectYamlPath = await join(targetDir, "project.yaml");
            if (await exists(projectYamlPath)) {
              const yaml = serializeProjectFile({
                id: `${repo.id}:${SEAQUEL_DIR}/projects/${newDirName}`,
                repoId: repo.id,
                name: updates.name,
                description: updates.description ?? project.description,
                dirName: newDirName,
                connections: [],
              });
              await writeTextFile(projectYamlPath, yaml);
            }

            // Reload shared state so in-memory paths reflect the renamed directory
            if (this.sharedRepos) {
              await this.sharedRepos.loadQueriesFromRepo(repo.id);
            }

            // Update sharedQueryId on open tabs whose paths changed
            if (oldDirName !== newDirName) {
              const oldSegment = `projects/${oldDirName}/`;
              const newSegment = `projects/${newDirName}/`;
              for (const [_, tabs] of Object.entries(this.state.queryTabsByProject)) {
                let changed = false;
                for (const tab of tabs) {
                  if (tab.sharedQueryId?.includes(oldSegment)) {
                    tab.sharedQueryId = tab.sharedQueryId.replace(oldSegment, newSegment);
                    changed = true;
                  }
                }
                if (changed) {
                  this.state.queryTabsByProject = { ...this.state.queryTabsByProject };
                }
              }
            }
          }
        } catch {
          // Directory may not exist yet
        }
      }
    }

    this.state.projects = this.state.projects.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...updates,
        updatedAt: new Date(),
      };
    });
    await this.persistence.persistProjects();
  }

  /**
   * Set the git repo path for a project and trigger scanning.
   * When set for the first time, auto-links the project to the repo.
   */
  async setGitRepoPath(projectId: string, path: string | undefined): Promise<void> {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;

    const hadGitPath = !!project.gitRepoPath;

    // Update the project
    await this.update(projectId, { gitRepoPath: path });

    if (path && this.sharedRepos) {
      // Create .seaquel directory structure while dialog scope is active
      try {
        const dirName = nameToFilename(project.name);
        const projectDir = await join(path, SEAQUEL_DIR, "projects", dirName);
        await mkdir(await join(projectDir, "connections"), { recursive: true });
        await mkdir(await join(projectDir, "queries"), { recursive: true });
      } catch {
        // Directory may already exist
      }

      // Check if a SharedQueryRepo entry already exists for this path
      const existingRepo = this.state.sharedRepos.find((r) => r.path === path);

      let activeRepoId: string;

      if (existingRepo) {
        activeRepoId = existingRepo.id;
        // Reuse existing repo - set as active when this project is active
        if (this.state.activeProjectId === projectId) {
          this.state.activeRepoId = existingRepo.id;
        }
        // Reload queries/configs
        await this.sharedRepos.loadQueriesFromRepo(existingRepo.id);
      } else {
        // Register the path as a new repo (without cloning)
        activeRepoId = await this.sharedRepos.initRepo(project.name, path);

        // Set as active when this project is active
        if (this.state.activeProjectId === projectId) {
          this.state.activeRepoId = activeRepoId;
        }

        // Load existing queries and shared configs from the repo
        await this.sharedRepos.loadQueriesFromRepo(activeRepoId);
      }

      // Auto-detect remote URL from the git repo
      const linkedRepo = this.state.sharedRepos.find((r) => r.path === path);
      if (linkedRepo && !linkedRepo.remoteUrl && isTauri()) {
        try {
          const { getRemoteUrl } = await import("$lib/services/git");
          const remoteUrl = await getRemoteUrl(path);
          if (remoteUrl) {
            await this.sharedRepos.setRemoteUrl(linkedRepo.id, remoteUrl);
          }
        } catch {
          // No remote configured — that's fine
        }
      }

      // If first-time setup, export existing non-local-only connections to git
      if (!hadGitPath) {
        const projectConnections = this.state.connections.filter(
          (c) => c.projectId === projectId && !c.isLocalOnly,
        );
        if (projectConnections.length > 0) {
          const activeRepo = this.state.sharedRepos.find((r) => r.path === path);
          if (activeRepo) {
            await this.sharedRepos.exportProject(
              activeRepo.id,
              project.name,
              projectConnections,
              {},
            );
          }
        }
      }
    } else if (!path) {
      // Clearing git path - don't remove the repo entry, just unlink
      // The activeRepoId will be managed on project switch
    }
  }

  /**
   * Delete a project and all its connections.
   * Cannot delete the last project.
   */
  async remove(id: string): Promise<boolean> {
    // Cannot delete the last project
    if (this.state.projects.length <= 1) {
      console.warn("Cannot delete the last project");
      return false;
    }

    const project = this.state.projects.find((p) => p.id === id);

    // Delete all connections in the project (must await to avoid race conditions
    // where setActiveForProject schedules persistence for the soon-to-be-deleted project)
    const projectConnections = this.state.connections.filter((c) => c.projectId === id);
    if (this.removeConnection) {
      for (const connection of projectConnections) {
        await this.removeConnection(connection.id);
      }
    }

    // Cancel any debounced persistence that may have been scheduled
    // by removeConnection (e.g. via setActiveForProject) to prevent
    // writing to a project that's about to be deleted
    this.persistence.cancelPendingPersistence();

    // Remove project directory from the git repo if linked
    if (project?.gitRepoPath && this.sharedRepos) {
      const repo = this.state.sharedRepos.find((r) => r.path === project.gitRepoPath);
      if (repo) {
        try {
          const dirName = nameToFilename(project.name);
          const projectDir = await join(repo.path, SEAQUEL_DIR, "projects", dirName);
          await removeDir(projectDir, { recursive: true });
        } catch {
          // Directory may not exist
        }
      }
    }

    // Remove project and its state from database
    await this.persistence.removeProjectState(id);
    await this.persistence.removeProject(id);

    // Remove from in-memory state
    this.state.projects = this.state.projects.filter((p) => p.id !== id);

    // Switch active project if needed
    if (this.state.activeProjectId === id) {
      // Clear active project ID first to prevent setActive from trying
      // to persist state for the just-deleted project (FK constraint)
      this.state.activeProjectId = null;
      await this.setActive(this.state.projects[0]?.id || null);
    }

    return true;
  }

  /**
   * Set the active project.
   */
  async setActive(id: string | null): Promise<void> {
    if (id === this.state.activeProjectId) return;

    // Save current project state before switching
    if (this.state.activeProjectId) {
      await this.persistence.persistProjectState(this.state.activeProjectId);
    }

    this.state.activeProjectId = id;
    await this.persistence.persistAppState();

    // Load new project state
    if (id) {
      await this.loadProjectState(id);

      // Auto-link repo when project has gitRepoPath
      const project = this.state.projects.find((p) => p.id === id);
      if (project?.gitRepoPath && this.sharedRepos) {
        const repo = this.state.sharedRepos.find((r) => r.path === project.gitRepoPath);
        if (repo) {
          this.state.activeRepoId = repo.id;
        }
      }
    }
  }

  /**
   * Add a custom label to a project.
   */
  async addCustomLabel(
    projectId: string,
    label: Omit<ConnectionLabel, "id" | "isPredefined">,
  ): Promise<ConnectionLabel> {
    const newLabel: ConnectionLabel = {
      id: `label-${Date.now()}`,
      name: label.name,
      color: label.color,
      isPredefined: false,
    };

    this.state.projects = this.state.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        customLabels: [...p.customLabels, newLabel],
        updatedAt: new Date(),
      };
    });
    await this.persistence.persistProjects();

    return newLabel;
  }

  /**
   * Remove a custom label from a project.
   * Also removes the label from all connections.
   */
  async removeCustomLabel(projectId: string, labelId: string): Promise<void> {
    // Remove from project
    this.state.projects = this.state.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        customLabels: p.customLabels.filter((l) => l.id !== labelId),
        updatedAt: new Date(),
      };
    });
    await this.persistence.persistProjects();

    // Remove from connections
    this.state.connections = this.state.connections.map((c) => {
      if (c.projectId !== projectId) return c;
      if (!c.labelIds.includes(labelId)) return c;
      return {
        ...c,
        labelIds: c.labelIds.filter((id) => id !== labelId),
      };
    });
  }

  /**
   * Update a custom label.
   */
  async updateCustomLabel(
    projectId: string,
    labelId: string,
    updates: Partial<Pick<ConnectionLabel, "name" | "color">>,
  ): Promise<void> {
    this.state.projects = this.state.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        customLabels: p.customLabels.map((l) => {
          if (l.id !== labelId) return l;
          return { ...l, ...updates };
        }),
        updatedAt: new Date(),
      };
    });
    await this.persistence.persistProjects();
  }

  // === PRIVATE METHODS ===

  /**
   * Import shared connections from the linked repo as local DatabaseConnection entries.
   * Skips connections that are already imported (matched by sharedConnectionId).
   * Called explicitly (e.g. on project settings save), not automatically on folder selection.
   */
  async importSharedConnections(projectId: string): Promise<void> {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project?.gitRepoPath) return;

    const repo = this.state.sharedRepos.find((r) => r.path === project.gitRepoPath);
    if (!repo) return;

    const repoId = repo.id;
    const sharedProjects = this.state.sharedProjectsByRepo[repoId] ?? [];

    for (const sharedProject of sharedProjects) {
      const sharedConnections = this.state.sharedConnectionsByProject[sharedProject.id] ?? [];

      for (const sharedConn of sharedConnections) {
        // Check if already imported
        const alreadyImported = this.state.connections.some(
          (c) => c.sharedConnectionId === sharedConn.id,
        );
        if (alreadyImported) continue;

        // Create a local DatabaseConnection from the shared template
        const connection: DatabaseConnection = {
          id: crypto.randomUUID(),
          name: sharedConn.name,
          type: sharedConn.type,
          host: sharedConn.host,
          port: sharedConn.port,
          databaseName: sharedConn.databaseName,
          username: "",
          password: "",
          sslMode: sharedConn.sslMode,
          projectId,
          labelIds: [],
          sharedConnectionId: sharedConn.id,
          sshTunnel: sharedConn.sshTunnel
            ? {
                enabled: true,
                host: sharedConn.sshTunnel.host,
                port: sharedConn.sshTunnel.port,
                username: "",
                authMethod: "key",
              }
            : undefined,
        };

        this.state.connections = [...this.state.connections, connection];
        await this.persistence.persistConnection(connection);
      }
    }
  }

  private createDefaultProject(): Project {
    const now = new Date();
    return {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      createdAt: now,
      updatedAt: now,
      customLabels: [],
    };
  }

  private deserializeProject(persisted: PersistedProject): Project {
    return {
      id: persisted.id,
      name: persisted.name,
      description: persisted.description,
      createdAt: new Date(persisted.createdAt),
      updatedAt: new Date(persisted.updatedAt),
      customLabels: persisted.customLabels,
      gitRepoPath: persisted.gitRepoPath,
    };
  }

  private async loadProjectState(projectId: string): Promise<void> {
    const persistedState = await this.persistence.loadProjectState(projectId);
    if (!persistedState) {
      // Initialize empty state for this project
      this.state.queryTabsByProject[projectId] = [];
      this.state.schemaTabsByProject[projectId] = [];
      this.state.explainTabsByProject[projectId] = [];
      this.state.erdTabsByProject[projectId] = [];
      this.state.statisticsTabsByProject[projectId] = [];
      this.state.canvasTabsByProject[projectId] = [];
      this.state.savedCanvasesByProject[projectId] = [];
      this.state.dashboardTabsByProject[projectId] = [];
      this.state.tabOrderByProject[projectId] = [];
      this.state.activeQueryTabIdByProject[projectId] = null;
      this.state.activeSchemaTabIdByProject[projectId] = null;
      this.state.activeExplainTabIdByProject[projectId] = null;
      this.state.activeErdTabIdByProject[projectId] = null;
      this.state.activeStatisticsTabIdByProject[projectId] = null;
      this.state.activeCanvasTabIdByProject[projectId] = null;
      this.state.activeDashboardTabIdByProject[projectId] = null;
      this.state.activeConnectionIdByProject[projectId] = null;
      this.state.connectionTabsByProject[projectId] = [];
      this.state.activeConnectionTabIdByProject[projectId] = null;
      // Initialize starter tabs for new projects
      this.initializeStarterTabs?.(projectId);
      return;
    }

    // Restore tabs - query tabs
    this.state.queryTabsByProject[projectId] = persistedState.queryTabs.map((t) => ({
      id: t.id,
      name: t.name,
      query: t.query,
      savedQueryId: t.savedQueryId,
      isExecuting: false,
    }));

    // Restore schema tabs (we'll need to look up the table info later)
    // For now, create placeholder tabs that will be populated when the connection loads
    this.state.schemaTabsByProject[projectId] = persistedState.schemaTabs.map((t) => ({
      id: t.id,
      table: {
        schema: t.schemaName,
        name: t.tableName,
        type: "table" as const, // Default to table, will be updated when metadata loads
        columns: [],
        indexes: [],
      },
    }));

    // Restore explain tabs
    this.state.explainTabsByProject[projectId] = persistedState.explainTabs.map((t) => ({
      id: t.id,
      name: t.name,
      sourceQuery: t.sourceQuery,
      isExecuting: false,
    }));

    // Restore ERD tabs (connectionId may be missing in old persisted data)
    this.state.erdTabsByProject[projectId] = persistedState.erdTabs
      .filter((t) => t.connectionId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connectionId!,
      }));

    // Restore statistics tabs
    this.state.statisticsTabsByProject[projectId] = (persistedState.statisticsTabs ?? [])
      .filter((t) => t.connectionId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connectionId,
        isLoading: false,
      }));

    // Restore canvas tabs
    this.state.canvasTabsByProject[projectId] = (persistedState.canvasTabs ?? [])
      .filter((t) => t.connectionId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connectionId,
      }));

    // Restore saved canvases
    this.state.savedCanvasesByProject[projectId] = persistedState.savedCanvases ?? [];

    // Restore tab order and active IDs
    this.state.tabOrderByProject[projectId] = persistedState.tabOrder;
    this.state.activeQueryTabIdByProject[projectId] = persistedState.activeQueryTabId;
    this.state.activeSchemaTabIdByProject[projectId] = persistedState.activeSchemaTabId;
    this.state.activeExplainTabIdByProject[projectId] = persistedState.activeExplainTabId;
    this.state.activeErdTabIdByProject[projectId] = persistedState.activeErdTabId;
    this.state.activeStatisticsTabIdByProject[projectId] =
      persistedState.activeStatisticsTabId ?? null;
    this.state.activeCanvasTabIdByProject[projectId] = persistedState.activeCanvasTabId ?? null;
    this.state.activeConnectionIdByProject[projectId] = persistedState.activeConnectionId;
    this.state.activeView = persistedState.activeView;

    // Restore starter tabs
    if (persistedState.starterTabs && persistedState.starterTabs.length > 0) {
      this.state.starterTabsByProject[projectId] = persistedState.starterTabs.map((t) => ({
        id: t.id,
        type: t.type,
        name: t.name,
        closable: t.closable,
      }));
      this.state.activeStarterTabIdByProject[projectId] = persistedState.activeStarterTabId ?? null;
    } else {
      // Initialize default starter tabs if none persisted
      this.initializeStarterTabs?.(projectId);
    }

    // Restore dashboard tabs
    this.state.dashboardTabsByProject[projectId] = (persistedState.dashboardTabs ?? [])
      .filter((t) => t.connectionId && t.dashboardId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connectionId,
        dashboardId: t.dashboardId,
      }));
    this.state.activeDashboardTabIdByProject[projectId] =
      persistedState.activeDashboardTabId ?? null;

    // Connection tabs are transient - always initialize empty
    this.state.connectionTabsByProject[projectId] = [];
    this.state.activeConnectionTabIdByProject[projectId] = null;
  }
}
