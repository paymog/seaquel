import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GitCredentials } from "$lib/types";

// ---------------------------------------------------------------------------
// Environment mock — force server mode for all tests
// ---------------------------------------------------------------------------

vi.mock("$lib/utils/environment", () => ({
  isServer: () => true,
  isTauri: () => false,
  isDemo: () => false,
  isBrowser: () => true,
}));

// ---------------------------------------------------------------------------
// Tauri mock — never called in server mode but import must not throw
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("invoke should not be called in server mode")),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import {
  cloneRepo,
  initRepo,
  pullRepo,
  pushRepo,
  getRepoStatus,
  commitChanges,
  stageFile,
  discardFile,
  resolveConflict,
  getConflictContent,
  setRemote,
  getRemoteUrl,
} from "./git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

const rustSyncResult = {
  success: true,
  message: "Push successful",
  conflicts: [],
  files_changed: ["a.sql"],
};

const rustRepoStatus = {
  is_clean: false,
  pending_changes: 2,
  ahead_by: 1,
  behind_by: 0,
  has_conflicts: false,
  current_branch: "main",
  modified_files: ["a.sql"],
  untracked_files: ["b.sql"],
};

const creds: GitCredentials = {
  username: "alice",
  password: "secret",
  sshKeyPath: undefined,
  sshPassphrase: undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// cloneRepo
// ---------------------------------------------------------------------------

describe("cloneRepo", () => {
  it("POSTs to /api/git/clone with url, path, credentials", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);

    await cloneRepo("https://github.com/x/y.git", "/repos/y", creds);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/git/clone");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.url).toBe("https://github.com/x/y.git");
    expect(body.path).toBe("/repos/y");
    expect(body.credentials.username).toBe("alice");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", makeFetch(500, "server error"));
    await expect(cloneRepo("url", "/path")).rejects.toThrow();
  });

  it("sends null credentials when omitted", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await cloneRepo("url", "/path");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.credentials).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initRepo
// ---------------------------------------------------------------------------

describe("initRepo", () => {
  it("POSTs to /api/git/init with path", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await initRepo("/repos/new");
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/git/init");
    expect(JSON.parse(opts.body as string)).toEqual({ path: "/repos/new" });
  });
});

// ---------------------------------------------------------------------------
// pullRepo
// ---------------------------------------------------------------------------

describe("pullRepo", () => {
  it("POSTs to /api/git/pull and converts snake_case response", async () => {
    vi.stubGlobal("fetch", makeFetch(200, rustSyncResult));
    const result = await pullRepo("/repos/y", creds);
    expect(result.success).toBe(true);
    expect(result.filesChanged).toEqual(["a.sql"]);
    expect(result.message).toBe("Push successful");
  });
});

// ---------------------------------------------------------------------------
// pushRepo
// ---------------------------------------------------------------------------

describe("pushRepo", () => {
  it("POSTs to /api/git/push and converts snake_case response", async () => {
    vi.stubGlobal("fetch", makeFetch(200, rustSyncResult));
    const result = await pushRepo("/repos/y");
    expect(result.success).toBe(true);
    expect(result.conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getRepoStatus
// ---------------------------------------------------------------------------

describe("getRepoStatus", () => {
  it("GETs /api/git/status?path=... and converts snake_case response", async () => {
    const fetch = makeFetch(200, rustRepoStatus);
    vi.stubGlobal("fetch", fetch);
    const status = await getRepoStatus("/repos/y");
    const [url] = fetch.mock.calls[0] as [string];
    expect(url).toBe("/api/git/status?path=%2Frepos%2Fy");
    expect(status.isClean).toBe(false);
    expect(status.pendingChanges).toBe(2);
    expect(status.currentBranch).toBe("main");
    expect(status.modifiedFiles).toEqual(["a.sql"]);
    expect(status.untrackedFiles).toEqual(["b.sql"]);
  });
});

// ---------------------------------------------------------------------------
// commitChanges
// ---------------------------------------------------------------------------

describe("commitChanges", () => {
  it("POSTs to /api/git/commit and returns commit_id", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { commit_id: "abc123" }));
    const id = await commitChanges("/repos/y", "initial commit");
    expect(id).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// stageFile
// ---------------------------------------------------------------------------

describe("stageFile", () => {
  it("POSTs to /api/git/stage with snake_case file_path", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await stageFile("/repos/y", "src/query.sql");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.file_path).toBe("src/query.sql");
    expect(body.path).toBe("/repos/y");
  });
});

// ---------------------------------------------------------------------------
// discardFile
// ---------------------------------------------------------------------------

describe("discardFile", () => {
  it("POSTs to /api/git/discard with snake_case file_path", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await discardFile("/repos/y", "src/query.sql");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.file_path).toBe("src/query.sql");
  });
});

// ---------------------------------------------------------------------------
// resolveConflict
// ---------------------------------------------------------------------------

describe("resolveConflict", () => {
  it("POSTs to /api/git/resolve with snake_case file_path and resolution", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await resolveConflict("/repos/y", "a.sql", "resolved content");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.file_path).toBe("a.sql");
    expect(body.resolution).toBe("resolved content");
  });
});

// ---------------------------------------------------------------------------
// getConflictContent
// ---------------------------------------------------------------------------

describe("getConflictContent", () => {
  it("GETs /api/git/conflict?path=...&file_path=... and returns content", async () => {
    const conflict = { base: "base", ours: "ours", theirs: "theirs" };
    const fetch = makeFetch(200, conflict);
    vi.stubGlobal("fetch", fetch);
    const content = await getConflictContent("/repos/y", "a.sql");
    const [url] = fetch.mock.calls[0] as [string];
    expect(url).toContain("/api/git/conflict?");
    expect(url).toContain("path=");
    expect(url).toContain("file_path=");
    expect(content).toEqual(conflict);
  });
});

// ---------------------------------------------------------------------------
// setRemote
// ---------------------------------------------------------------------------

describe("setRemote", () => {
  it("POSTs to /api/git/remote with path and url", async () => {
    const fetch = makeFetch(204);
    vi.stubGlobal("fetch", fetch);
    await setRemote("/repos/y", "https://github.com/x/y.git");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.url).toBe("https://github.com/x/y.git");
    expect(body.path).toBe("/repos/y");
  });
});

// ---------------------------------------------------------------------------
// getRemoteUrl
// ---------------------------------------------------------------------------

describe("getRemoteUrl", () => {
  it("GETs /api/git/remote-url?path=... and returns url", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { url: "https://github.com/x/y.git" }));
    const url = await getRemoteUrl("/repos/y");
    expect(url).toBe("https://github.com/x/y.git");
  });

  it("returns null when url is null", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { url: null }));
    const url = await getRemoteUrl("/repos/y");
    expect(url).toBeNull();
  });
});
