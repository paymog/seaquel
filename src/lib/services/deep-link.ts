/**
 * Deep link handling for seaquel:// URLs.
 * Supports opening shared queries by repo remote URL + file path.
 */

import type { useDatabase } from "$lib/hooks/database.svelte.js";
import { deepLinkDialogStore } from "$lib/stores/deep-link-dialog.svelte.js";
import { toast } from "svelte-sonner";

type DatabaseContext = ReturnType<typeof useDatabase>;

export interface DeepLinkAction {
  type: "shared-query";
  repoUrl: string;
  filePath: string;
  branch: string;
}

/**
 * Build a seaquel:// deep link URL for a shared query.
 */
export function buildDeepLinkUrl(repoUrl: string, filePath: string, branch?: string): string {
  let url = `seaquel://shared-query?repo=${repoUrl}&path=${filePath}`;
  if (branch && branch !== "main") {
    url += `&branch=${branch}`;
  }
  return url;
}

/**
 * Parse a seaquel:// URL into a typed action.
 * Returns null if the URL is invalid or unsupported.
 */
export function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    // seaquel://shared-query?repo=...&path=...&branch=...
    const parsed = new URL(url);
    if (parsed.protocol !== "seaquel:") return null;

    const type = parsed.hostname || parsed.pathname.replace(/^\/\//, "");
    if (type !== "shared-query") return null;

    const repoUrl = parsed.searchParams.get("repo");
    const filePath = parsed.searchParams.get("path");
    const branch = parsed.searchParams.get("branch") || "main";

    if (!repoUrl || !filePath) return null;

    return { type: "shared-query", repoUrl, filePath, branch };
  } catch {
    return null;
  }
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
    // Fallback: return as-is
    return normalized.toLowerCase();
  }
}

/**
 * Handle a deep link URL. Finds the matching repo and opens the query,
 * or prompts the user to clone the repo if not found locally.
 */
export async function handleDeepLink(url: string, db: DatabaseContext): Promise<void> {
  const action = parseDeepLink(url);
  if (!action) return;

  // Wait for app initialization to complete
  await db.whenReady();

  if (action.type === "shared-query") {
    await handleSharedQueryDeepLink(action, db);
  }
}

async function handleSharedQueryDeepLink(
  action: DeepLinkAction,
  db: DatabaseContext,
): Promise<void> {
  const normalizedActionUrl = normalizeGitUrl(action.repoUrl);

  // Find a local repo matching this remote URL
  const matchingRepo = db.state.sharedRepos.find(
    (repo) => normalizeGitUrl(repo.remoteUrl) === normalizedActionUrl,
  );

  if (matchingRepo) {
    // Repo exists locally — find and open the query
    openQueryFromRepo(matchingRepo.id, action.filePath, db);
  } else {
    // Repo not cloned — show clone dialog
    const cloned = await deepLinkDialogStore.prompt(action.repoUrl, action.filePath, action.branch);
    if (cloned) {
      // After cloning, try to find the repo again
      const newRepo = db.state.sharedRepos.find(
        (repo) => normalizeGitUrl(repo.remoteUrl) === normalizedActionUrl,
      );
      if (newRepo) {
        openQueryFromRepo(newRepo.id, action.filePath, db);
      }
    }
  }
}

function openQueryFromRepo(repoId: string, filePath: string, db: DatabaseContext): void {
  const queries = db.state.sharedQueriesByRepo[repoId] ?? [];
  const query = queries.find((q) => q.filePath === filePath);

  if (query) {
    // Set the repo as active and open the query in a tab
    db.sharedRepos.setActiveRepo(repoId);
    db.queryTabs.loadSharedQuery(query.id, query.name, query.query, () =>
      db.ui.setActiveView("query"),
    );
    toast.success(`Opened shared query: ${query.name}`);
  } else {
    toast.error(`Query not found: ${filePath}`);
  }
}
