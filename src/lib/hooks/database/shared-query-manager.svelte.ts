import type { SharedQuery, QueryParameter, SavedQuery } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import { SEAQUEL_DIR, type SharedRepoManager } from "./shared-repo-manager.svelte.js";
import {
  parseQueryFile,
  serializeQueryFile,
  queryNameToFilename,
  isValidQueryPath,
} from "$lib/services/query-file-parser";
import { nameToFilename } from "$lib/services/config-file-parser";
import { readTextFile, writeTextFile, remove, mkdir, exists, rename } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";

/**
 * Manages individual shared queries: create, update, delete.
 */
/**
 * Parse a composite query ID ("repoId:filePath") into its parts.
 */
function parseQueryId(queryId: string): { repoId: string; filePath: string } {
  const [repoId, ...pathParts] = queryId.split(":");
  return { repoId, filePath: pathParts.join(":") };
}

export class SharedQueryManager {
  constructor(
    private state: DatabaseState,
    private repoManager: SharedRepoManager,
  ) {}

  /**
   * Get the queries base path for the active project (e.g., ".seaquel/projects/my-project/queries").
   */
  private getQueriesBasePath(): string | null {
    const project = this.state.projects.find((p) => p.id === this.state.activeProjectId);
    if (!project) return null;
    const dirName = nameToFilename(project.name);
    return `${SEAQUEL_DIR}/projects/${dirName}/queries`;
  }

  /**
   * Extract the queries base path from an existing filePath
   * (e.g., ".seaquel/projects/my-project/queries" from ".seaquel/projects/my-project/queries/analytics/file.sql").
   */
  private extractQueriesBase(filePath: string): string {
    const match = filePath.match(/^(\.seaquel\/projects\/[^/]+\/queries)\//);
    return match ? match[1] : "";
  }

  /**
   * Create a new shared query in the active repository.
   */
  async createQuery(
    name: string,
    query: string,
    folder: string = "",
    options?: {
      description?: string;
      databaseType?: string;
      tags?: string[];
      parameters?: QueryParameter[];
    },
  ): Promise<string | null> {
    const repoId = this.state.activeRepoId;
    if (!repoId) return null;

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return null;

    const queriesBase = this.getQueriesBasePath();
    if (!queriesBase) return null;

    // Generate file path under .seaquel/projects/<name>/queries/
    const filename = queryNameToFilename(name);
    const relPath = folder ? `${folder}/${filename}` : filename;
    const filePath = `${queriesBase}/${relPath}`;

    if (!isValidQueryPath(filePath)) {
      throw new Error("Invalid query file path");
    }

    // Create the SharedQuery object
    const sharedQuery: SharedQuery = {
      id: `${repoId}:${filePath}`,
      repoId,
      filePath,
      name,
      description: options?.description,
      query,
      parameters: options?.parameters,
      databaseType: options?.databaseType,
      tags: options?.tags ?? [],
      folder,
      updatedAt: new Date(),
    };

    // Serialize to file content
    const content = serializeQueryFile(sharedQuery);

    // Ensure folder exists
    const fullPath = await join(repo.path, filePath);
    const folderPath = await dirname(fullPath);

    if (!(await exists(folderPath))) {
      await mkdir(folderPath, { recursive: true });
    }

    // Write file
    await writeTextFile(fullPath, content);

    // Add to state
    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    this.state.sharedQueriesByRepo = {
      ...this.state.sharedQueriesByRepo,
      [repoId]: [...queries, sharedQuery],
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return sharedQuery.id;
  }

  /**
   * Update an existing shared query.
   */
  async updateQuery(
    queryId: string,
    updates: {
      name?: string;
      query?: string;
      description?: string;
      databaseType?: string;
      tags?: string[];
      parameters?: QueryParameter[];
    },
  ): Promise<string | null> {
    // Find the query
    const { repoId, filePath } = parseQueryId(queryId);

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return null;

    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    const queryIndex = queries.findIndex((q) => q.id === queryId);
    if (queryIndex === -1) return null;

    const existingQuery = queries[queryIndex];

    // Create updated query
    const updatedQuery: SharedQuery = {
      ...existingQuery,
      name: updates.name ?? existingQuery.name,
      query: updates.query ?? existingQuery.query,
      description: updates.description ?? existingQuery.description,
      databaseType: updates.databaseType ?? existingQuery.databaseType,
      tags: updates.tags ?? existingQuery.tags,
      parameters: updates.parameters ?? existingQuery.parameters,
    };

    // Handle rename (file path change)
    let newFilePath = filePath;
    if (updates.name && updates.name !== existingQuery.name) {
      const folder = existingQuery.folder;
      const queriesBase = this.extractQueriesBase(filePath);
      const newFilename = queryNameToFilename(updates.name);
      const relPath = folder ? `${folder}/${newFilename}` : newFilename;
      newFilePath = queriesBase ? `${queriesBase}/${relPath}` : relPath;

      if (newFilePath !== filePath) {
        // Rename file
        const oldFullPath = await join(repo.path, filePath);
        const newFullPath = await join(repo.path, newFilePath);

        await rename(oldFullPath, newFullPath);

        // Update query object
        updatedQuery.id = `${repoId}:${newFilePath}`;
        updatedQuery.filePath = newFilePath;
      }
    }

    // Serialize and write updated content
    const content = serializeQueryFile(updatedQuery);
    const fullPath = await join(repo.path, updatedQuery.filePath);
    await writeTextFile(fullPath, content);

    // Update state
    const updatedQueries = [...queries];
    updatedQueries[queryIndex] = updatedQuery;
    this.state.sharedQueriesByRepo = {
      ...this.state.sharedQueriesByRepo,
      [repoId]: updatedQueries,
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return updatedQuery.id;
  }

  /**
   * Delete a shared query.
   */
  async deleteQuery(queryId: string): Promise<boolean> {
    const { repoId, filePath } = parseQueryId(queryId);

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return false;

    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    const query = queries.find((q) => q.id === queryId);
    if (!query) return false;

    // Delete file
    const fullPath = await join(repo.path, filePath);
    await remove(fullPath);

    // Remove from state
    this.state.sharedQueriesByRepo = {
      ...this.state.sharedQueriesByRepo,
      [repoId]: queries.filter((q) => q.id !== queryId),
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return true;
  }

  /**
   * Move a query to a different folder.
   */
  async moveQuery(queryId: string, newFolder: string): Promise<boolean> {
    const { repoId, filePath } = parseQueryId(queryId);

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return false;

    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    const queryIndex = queries.findIndex((q) => q.id === queryId);
    if (queryIndex === -1) return false;

    const query = queries[queryIndex];
    const filename = filePath.split("/").pop() || "";
    const queriesBase = this.extractQueriesBase(filePath);
    const relPath = newFolder ? `${newFolder}/${filename}` : filename;
    const newFilePath = queriesBase ? `${queriesBase}/${relPath}` : relPath;

    if (!isValidQueryPath(newFilePath)) {
      throw new Error("Invalid target folder");
    }

    // Ensure target folder exists
    const targetDir = queriesBase
      ? newFolder
        ? `${queriesBase}/${newFolder}`
        : queriesBase
      : newFolder;
    if (targetDir) {
      const targetFolderPath = await join(repo.path, targetDir);
      if (!(await exists(targetFolderPath))) {
        await mkdir(targetFolderPath, { recursive: true });
      }
    }

    // Move file
    const oldFullPath = await join(repo.path, filePath);
    const newFullPath = await join(repo.path, newFilePath);
    await rename(oldFullPath, newFullPath);

    // Update query object
    const updatedQuery: SharedQuery = {
      ...query,
      id: `${repoId}:${newFilePath}`,
      filePath: newFilePath,
      folder: newFolder,
    };

    // Update state
    const updatedQueries = [...queries];
    updatedQueries[queryIndex] = updatedQuery;
    this.state.sharedQueriesByRepo = {
      ...this.state.sharedQueriesByRepo,
      [repoId]: updatedQueries,
    };

    await this.repoManager.refreshRepoStatus(repoId);
    return true;
  }

  /**
   * Create a new folder in the repository's queries directory.
   */
  async createFolder(folderPath: string): Promise<boolean> {
    const repoId = this.state.activeRepoId;
    if (!repoId) return false;

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return false;

    const queriesBase = this.getQueriesBasePath();
    if (!queriesBase) return false;

    const repoRelPath = `${queriesBase}/${folderPath}`;
    const fullPath = await join(repo.path, repoRelPath);

    if (await exists(fullPath)) {
      return false; // Already exists
    }

    await mkdir(fullPath, { recursive: true });

    // Create .gitkeep to track empty folder
    const gitkeepPath = await join(fullPath, ".gitkeep");
    await writeTextFile(gitkeepPath, "");

    return true;
  }

  /**
   * Get a shared query by ID.
   */
  getQuery(queryId: string): SharedQuery | null {
    const { repoId } = parseQueryId(queryId);
    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    return queries.find((q) => q.id === queryId) ?? null;
  }

  /**
   * Get all queries in a specific folder.
   */
  getQueriesInFolder(repoId: string, folder: string): SharedQuery[] {
    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    return queries.filter((q) => q.folder === folder);
  }

  /**
   * Get all unique folder paths in a repository.
   */
  getFolders(repoId: string): string[] {
    const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    const folders = new Set<string>();

    for (const query of queries) {
      if (query.folder) {
        // Add the folder and all parent folders
        const parts = query.folder.split("/");
        for (let i = 1; i <= parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
      }
    }

    return Array.from(folders).sort();
  }

  /**
   * Search queries across all repositories.
   */
  searchQueries(searchTerm: string, repoId?: string): SharedQuery[] {
    const term = searchTerm.toLowerCase();
    let queries: SharedQuery[];

    if (repoId) {
      queries = this.state.sharedQueriesByRepo[repoId] ?? [];
    } else {
      queries = this.state.allSharedQueries;
    }

    return queries.filter((q) => {
      return (
        q.name.toLowerCase().includes(term) ||
        q.description?.toLowerCase().includes(term) ||
        q.query.toLowerCase().includes(term) ||
        q.tags.some((t) => t.toLowerCase().includes(term))
      );
    });
  }

  /**
   * Reload a single query from disk.
   */
  async reloadQuery(queryId: string): Promise<void> {
    const { repoId, filePath } = parseQueryId(queryId);

    const repo = this.state.sharedRepos.find((r) => r.id === repoId);
    if (!repo) return;

    const fullPath = await join(repo.path, filePath);

    try {
      const content = await readTextFile(fullPath);
      const query = parseQueryFile(content, repoId, filePath);

      if (query) {
        const queries = this.state.sharedQueriesByRepo[repoId] ?? [];
        const index = queries.findIndex((q) => q.id === queryId);

        if (index !== -1) {
          const updatedQueries = [...queries];
          updatedQueries[index] = query;
          this.state.sharedQueriesByRepo = {
            ...this.state.sharedQueriesByRepo,
            [repoId]: updatedQueries,
          };
        }
      }
    } catch (error) {
      console.error("Failed to reload query:", error);
    }
  }

  /**
   * Share a saved query by writing it as a .sql file to the active repo.
   * Does not stage or commit — the user handles that manually.
   */
  async shareQuery(savedQuery: SavedQuery): Promise<string | null> {
    return this.createQuery(savedQuery.name, savedQuery.query, "", {
      parameters: savedQuery.parameters,
    });
  }

  /**
   * Unshare a shared query by deleting its .sql file from the repo.
   * Does not stage or commit — the user handles that manually.
   */
  async unshareQuery(queryId: string): Promise<boolean> {
    return this.deleteQuery(queryId);
  }
}
