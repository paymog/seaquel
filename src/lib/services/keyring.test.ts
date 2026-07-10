import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerKeyringService, getKeyringService } from "./keyring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const { status, body = null } = responses[call++] ?? { status: 200 };
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
}

// ---------------------------------------------------------------------------
// ServerKeyringService
// ---------------------------------------------------------------------------

describe("ServerKeyringService", () => {
  let svc: ServerKeyringService;

  beforeEach(() => {
    svc = new ServerKeyringService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("setDbPassword POSTs to /api/secrets and resolves", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.setDbPassword("conn1", "pw");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/secrets");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ key: "db:conn1", value: "pw" });
  });

  it("getDbPassword returns value on 200", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { value: "secret" } }]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await svc.getDbPassword("conn1");

    expect(result).toBe("secret");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/secrets/db%3Aconn1");
  });

  it("getDbPassword returns null on 404", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 404 }]));
    expect(await svc.getDbPassword("missing")).toBeNull();
  });

  it("deleteDbPassword DELETEs the correct key", async () => {
    const fetchMock = mockFetch([{ status: 204 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.deleteDbPassword("conn1");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/secrets/db%3Aconn1");
    expect(opts.method).toBe("DELETE");
  });

  it("setSshPassword uses ssh: prefix", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.setSshPassword("conn2", "sshpw");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      key: "ssh:conn2",
      value: "sshpw",
    });
  });

  it("setSshKeyPassphrase uses ssh-key: prefix", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.setSshKeyPassphrase("conn3", "phrase");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      key: "ssh-key:conn3",
      value: "phrase",
    });
  });

  it("deleteAllForConnection deletes db, ssh, and ssh-key entries", async () => {
    const fetchMock = mockFetch([
      { status: 204 },
      { status: 204 },
      { status: 204 },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.deleteAllForConnection("conn4");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([url]: [string]) => url);
    expect(urls).toContain("/api/secrets/db%3Aconn4");
    expect(urls).toContain("/api/secrets/ssh%3Aconn4");
    expect(urls).toContain("/api/secrets/ssh-key%3Aconn4");
  });

  it("setLicenseKey uses license-key", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.setLicenseKey("lic-123");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      key: "license-key",
      value: "lic-123",
    });
  });

  it("setAIApiKeyForProvider uses ai-api-key: prefix", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    vi.stubGlobal("fetch", fetchMock);

    await svc.setAIApiKeyForProvider("openai", "sk-abc");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      key: "ai-api-key:openai",
      value: "sk-abc",
    });
  });

  it("isAvailable returns true", () => {
    expect(svc.isAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getKeyringService factory
// ---------------------------------------------------------------------------

describe("getKeyringService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error - reset Tauri marker
    delete window.__TAURI_INTERNALS__;
    // Reset the module singleton via the module's internal cache.
    // We achieve this by re-importing the module with resetModules in each test.
  });

  it("returns ServerKeyringService when isServer() is true", async () => {
    vi.stubEnv("VITE_IS_SERVER", "true");
    // Reset singleton so factory re-evaluates the environment.
    vi.resetModules();
    // Dynamic import is intentional here: we need a fresh module instance
    // to re-run the singleton initialisation with the stubbed env.
    const { getKeyringService: freshGet, ServerKeyringService: S } =
      // eslint-disable-next-line no-restricted-syntax
      await import("./keyring");
    expect(freshGet()).toBeInstanceOf(S);
    vi.resetModules();
  });

  it("returns NoopKeyringService in demo mode (no Tauri, no server)", async () => {
    vi.resetModules();
    const { getKeyringService: freshGet } = await import("./keyring");
    const svc = freshGet();
    expect(svc.isAvailable()).toBe(false);
    vi.resetModules();
  });
});
