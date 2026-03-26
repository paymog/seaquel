/**
 * Deep link handling for seaquel:// URLs.
 * Format: seaquel://open?r=<github-url-to-resource>
 *
 * Users copy a file URL from the GitHub web interface and prepend seaquel://open?r=
 * to create a working deep link. The resource type is inferred from the file path.
 */

import type { useDatabase } from "$lib/hooks/database.svelte.js";
import { deepLinkDialogStore } from "$lib/stores/deep-link-dialog.svelte.js";
import { deepLinkProjectPickerStore } from "$lib/stores/deep-link-project-picker.svelte.js";
import { toast } from "svelte-sonner";

type DatabaseContext = ReturnType<typeof useDatabase>;

export type DeepLinkResourceType = "query" | "connection" | "dashboard" | "project";

export interface DeepLinkAction {
  type: DeepLinkResourceType;
  repoUrl: string;
  branch: string;
  filePath: string;
}

/**
 * Parse a GitHub blob/tree URL into its components.
 * Handles:
 *   HTTPS: https://github.com/{owner}/{repo}/blob/{branch}/{path}
 *   SSH:   git@github.com:{owner}/{repo}.git/blob/{branch}/{path}
 */
export function parseGitHubUrl(
  url: string,
): { repoUrl: string; branch: string; filePath: string } | null {
  // SSH format: git@github.com:owner/repo.git/blob/branch/path
  const sshMatch = url.match(
    /^([\w.-]+@([^:]+):([^/]+\/[^/]+?))(?:\.git)?\/(blob|tree)\/([^/]+)\/(.+?)\/?\s*$/,
  );
  if (sshMatch) {
    const [, repoUrl, , , , branch, filePath] = sshMatch;
    return { repoUrl, branch, filePath };
  }

  // HTTPS format: https://github.com/owner/repo/blob/branch/path
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/(blob|tree)\/([^/]+)\/(.+?)\/?\s*$/);
    if (!match) return null;

    const [, ownerRepo, , branch, filePath] = match;
    return {
      repoUrl: `${parsed.origin}/${ownerRepo}`,
      branch,
      filePath,
    };
  } catch {
    return null;
  }
}

/**
 * Infer the resource type from a file path within a .seaquel/ directory.
 */
export function inferResourceType(filePath: string): DeepLinkResourceType | null {
  if (/\/connections\/[^/]+\.ya?ml$/.test(filePath)) return "connection";
  if (/\/queries\/.*\.sql$/.test(filePath)) return "query";
  if (/\/dashboards\/[^/]+\.json$/.test(filePath)) return "dashboard";
  // Project: path like .seaquel/projects/<name> (directory, no file extension)
  if (/\/projects\/[^/]+\/?$/.test(filePath) && !/\.\w+$/.test(filePath)) return "project";
  return null;
}

/**
 * Parse a seaquel://open?r=<github-url> deep link into a typed action.
 */
export function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "seaquel:") return null;

    const host = parsed.hostname || parsed.pathname.replace(/^\/\//, "");
    if (host !== "open") return null;

    const githubUrl = parsed.searchParams.get("r");
    if (!githubUrl) return null;

    const parts = parseGitHubUrl(githubUrl);
    if (!parts) return null;

    const type = inferResourceType(parts.filePath);
    if (!type) return null;

    return { type, ...parts };
  } catch {
    return null;
  }
}

/**
 * Build a seaquel://open?r=<github-url> deep link.
 */
export function buildDeepLinkUrl(githubRepoUrl: string, branch: string, filePath: string): string {
  // For projects (directories), use tree/; for files, use blob/
  const pathType = filePath.includes(".") ? "blob" : "tree";
  const githubUrl = `${githubRepoUrl.replace(/\/+$/, "")}/${pathType}/${branch}/${filePath}`;
  return `seaquel://open?r=${githubUrl}`;
}

/**
 * Normalize a Git URL to a canonical `host/org/repo` form for comparison.
 * Handles HTTPS, SSH (git@), and trailing .git / slashes.
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // Remove trailing slashes and .git suffix
  normalized = normalized.replace(/\/+$/, "").replace(/\.git$/, "");

  // SSH format: git@github.com:org/repo -> github.com/org/repo
  const sshMatch = normalized.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();
  }

  // HTTPS format: https://github.com/org/repo -> github.com/org/repo
  try {
    const parsed = new URL(normalized);
    return `${parsed.host}${parsed.pathname}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

/**
 * Handle a deep link URL. Dispatches to the appropriate handler based on resource type.
 */
export async function handleDeepLink(url: string, db: DatabaseContext): Promise<void> {
  const action = parseDeepLink(url);
  if (!action) return;

  await db.whenReady();

  const repo = await resolveRepo(action, db);
  if (!repo) return;

  switch (action.type) {
    case "query":
      handleQueryDeepLink(repo.id, action.filePath, db);
      break;
    case "dashboard":
      handleDashboardDeepLink(repo.id, action.filePath, db);
      break;
    case "connection":
      await handleConnectionDeepLink(repo.id, action.filePath, db);
      break;
    case "project":
      await handleProjectDeepLink(repo.id, action.filePath, db);
      break;
  }
}

/**
 * Find the local repo matching the deep link, or prompt to clone it.
 */
async function resolveRepo(
  action: DeepLinkAction,
  db: DatabaseContext,
): Promise<{ id: string } | null> {
  const normalizedActionUrl = normalizeGitUrl(action.repoUrl);

  const findRepo = () =>
    db.state.sharedRepos.find((repo) => normalizeGitUrl(repo.remoteUrl) === normalizedActionUrl);

  let repo = findRepo();
  if (repo) return repo;

  // Repo not cloned — show clone dialog
  const cloned = await deepLinkDialogStore.prompt(
    action.type,
    action.repoUrl,
    action.filePath,
    action.branch,
  );
  if (!cloned) return null;

  return findRepo() ?? null;
}

function handleQueryDeepLink(repoId: string, filePath: string, db: DatabaseContext): void {
  // Look up from scan cache first, then match to unified queries by name
  const scannedQueries = db.state.sharedQueriesByRepo[repoId] ?? [];
  const scannedQuery = scannedQueries.find((q) => q.filePath === filePath);

  if (scannedQuery) {
    db.sharedRepos.setActiveRepo(repoId);
    // Find the unified query by matching name
    const unifiedQuery = db.state.projectQueries.find(
      (q) => q.shared && q.name === scannedQuery.name,
    );
    if (unifiedQuery) {
      db.queryTabs.loadQuery(unifiedQuery.id, () => db.ui.setActiveView("query"));
    } else {
      // Fallback: open as a new tab with the scanned content
      db.queryTabs.focusOrCreate(scannedQuery.query, scannedQuery.name, () =>
        db.ui.setActiveView("query"),
      );
    }
    toast.success(`Opened shared query: ${scannedQuery.name}`);
  } else {
    toast.error(`Query not found: ${filePath}`);
  }
}

function handleDashboardDeepLink(repoId: string, filePath: string, db: DatabaseContext): void {
  const dashboards = db.state.sharedDashboardsByRepo[repoId] ?? [];
  const dashboard = dashboards.find((d) => d.filePath === filePath);

  if (dashboard) {
    db.sharedRepos.setActiveRepo(repoId);
    db.dashboardTabs.add(dashboard.id, dashboard.name);
    toast.success(`Opened shared dashboard: ${dashboard.name}`);
  } else {
    toast.error(`Dashboard not found: ${filePath}`);
  }
}

async function handleConnectionDeepLink(
  repoId: string,
  filePath: string,
  db: DatabaseContext,
): Promise<void> {
  const connection = db.state.allSharedConnections.find(
    (c) => c.repoId === repoId && c.filePath === filePath,
  );

  if (!connection) {
    toast.error(`Connection not found: ${filePath}`);
    return;
  }

  // Check if already imported
  const alreadyImported = db.state.connections.find((c) => c.sharedConnectionId === connection.id);
  if (alreadyImported) {
    toast.info(`Connection already imported: ${connection.name}`);
    return;
  }

  // Pick target project
  const projectId = await pickTargetProject("connection", connection.name, db);
  if (!projectId) return;

  // Import the connection into the selected project
  await db.projects.importSingleSharedConnection(connection, projectId);
  toast.success(`Imported connection: ${connection.name}`);
}

async function handleProjectDeepLink(
  repoId: string,
  filePath: string,
  db: DatabaseContext,
): Promise<void> {
  // Extract project dirName from path like .seaquel/projects/<dirName>
  const dirName = filePath.replace(/\/$/, "").split("/").pop();
  if (!dirName) {
    toast.error("Invalid project path");
    return;
  }

  const sharedProjects = db.state.sharedProjectsByRepo[repoId] ?? [];
  const sharedProject = sharedProjects.find((p) => p.dirName === dirName);

  if (!sharedProject) {
    toast.error(`Project not found: ${dirName}`);
    return;
  }

  // Check if already imported (project linked to same repo with matching dir)
  const alreadyImported = db.state.projects.find((p) => {
    if (!p.gitRepoPath) return false;
    const repo = db.state.sharedRepos.find((r) => r.path === p.gitRepoPath);
    return repo?.id === repoId;
  });

  if (alreadyImported) {
    await db.projects.setActive(alreadyImported.id);
    toast.info(`Project already imported: ${alreadyImported.name}`);
    return;
  }

  const repo = db.state.sharedRepos.find((r) => r.id === repoId);
  if (!repo) return;

  await db.projects.importFromGitRepo(repo.path, [sharedProject]);
  toast.success(`Imported project: ${sharedProject.name}`);
}

/**
 * Pick which project to import a resource into.
 * Auto-selects if there's only one project, otherwise shows a picker dialog.
 */
async function pickTargetProject(
  resourceType: DeepLinkResourceType,
  resourceName: string,
  db: DatabaseContext,
): Promise<string | null> {
  const projects = db.state.projects;

  if (projects.length === 1) {
    return projects[0].id;
  }

  // If there's an active project, offer it as default
  return deepLinkProjectPickerStore.prompt(resourceType, resourceName);
}
