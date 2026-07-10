import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TunnelConfig, TunnelResult } from "./ssh-tunnel";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted above imports of the module under test.
// Vitest hoists vi.mock() calls automatically.
// ---------------------------------------------------------------------------

vi.mock("$lib/utils/environment", () => ({
  isServer: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Import after mocks are registered so the module under test sees them.
import { createSshTunnel, closeSshTunnel, checkTunnelStatus, listActiveTunnels } from "./ssh-tunnel";
import { isServer } from "$lib/utils/environment";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status: number, body: unknown, text?: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text ?? String(status)),
  });
}

const baseConfig: TunnelConfig = {
  sshHost: "bastion.example.com",
  sshPort: 22,
  sshUsername: "alice",
  authMethod: "password",
  password: "s3cret",
  remoteHost: "db.internal",
  remotePort: 5432,
};

// ---------------------------------------------------------------------------
// Tests — server mode (fetch path)
// ---------------------------------------------------------------------------

describe("createSshTunnel — server mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs snake_case body to /api/ssh/tunnel and returns camelCase result", async () => {
    const mockFetch = makeFetch(200, { tunnel_id: "tunnel-1", local_port: 54321 });
    vi.stubGlobal("fetch", mockFetch);

    const result: TunnelResult = await createSshTunnel(baseConfig);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/ssh/tunnel");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const sent = JSON.parse(init.body);
    expect(sent.ssh_host).toBe("bastion.example.com");
    expect(sent.ssh_port).toBe(22);
    expect(sent.ssh_username).toBe("alice");
    expect(sent.auth_method).toBe("password");
    expect(sent.password).toBe("s3cret");
    expect(sent.remote_host).toBe("db.internal");
    expect(sent.remote_port).toBe(5432);

    expect(result).toEqual({ tunnelId: "tunnel-1", localPort: 54321 });
  });

  it("includes optional key fields when provided", async () => {
    const mockFetch = makeFetch(200, { tunnel_id: "tunnel-2", local_port: 12345 });
    vi.stubGlobal("fetch", mockFetch);

    await createSshTunnel({
      ...baseConfig,
      authMethod: "key",
      password: undefined,
      keyPath: "/home/alice/.ssh/id_rsa",
      keyPassphrase: "passphrase",
    });

    const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sent.auth_method).toBe("key");
    expect(sent.key_path).toBe("/home/alice/.ssh/id_rsa");
    expect(sent.key_passphrase).toBe("passphrase");
  });

  it("throws when fetch response is not ok", async () => {
    vi.stubGlobal("fetch", makeFetch(500, null, "internal error"));
    await expect(createSshTunnel(baseConfig)).rejects.toThrow("internal error");
  });
});

// ---------------------------------------------------------------------------
// Tests — Tauri mode (invoke path)
// ---------------------------------------------------------------------------

describe("createSshTunnel — Tauri mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes create_ssh_tunnel with snake_case config and returns camelCase", async () => {
    vi.mocked(invoke).mockResolvedValue({ tunnel_id: "tunnel-3", local_port: 9999 });

    const result = await createSshTunnel(baseConfig);

    expect(invoke).toHaveBeenCalledWith("create_ssh_tunnel", {
      config: {
        ssh_host: "bastion.example.com",
        ssh_port: 22,
        ssh_username: "alice",
        auth_method: "password",
        password: "s3cret",
        key_path: undefined,
        key_passphrase: undefined,
        remote_host: "db.internal",
        remote_port: 5432,
      },
    });
    expect(result).toEqual({ tunnelId: "tunnel-3", localPort: 9999 });
  });
});

// ---------------------------------------------------------------------------
// closeSshTunnel — server mode
// ---------------------------------------------------------------------------

describe("closeSshTunnel — server mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends DELETE to the tunnel endpoint", async () => {
    const mockFetch = makeFetch(204, null);
    vi.stubGlobal("fetch", mockFetch);

    await closeSshTunnel("tunnel-1");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/ssh/tunnel/tunnel-1");
    expect(init.method).toBe("DELETE");
  });

  it("percent-encodes the tunnel id in the URL", async () => {
    vi.stubGlobal("fetch", makeFetch(204, null));

    await closeSshTunnel("tunnel/with/slashes");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/ssh/tunnel/tunnel%2Fwith%2Fslashes");
  });
});

// ---------------------------------------------------------------------------
// closeSshTunnel — Tauri mode
// ---------------------------------------------------------------------------

describe("closeSshTunnel — Tauri mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes close_ssh_tunnel with the tunnel id", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await closeSshTunnel("tunnel-42");

    expect(invoke).toHaveBeenCalledWith("close_ssh_tunnel", { tunnelId: "tunnel-42" });
  });
});

// ---------------------------------------------------------------------------
// checkTunnelStatus — server mode
// ---------------------------------------------------------------------------

describe("checkTunnelStatus — server mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GETs status endpoint and returns active flag", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { active: true }));

    const active = await checkTunnelStatus("tunnel-1");
    expect(active).toBe(true);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/ssh/tunnel/tunnel-1/status");
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal("fetch", makeFetch(404, null, "not found"));
    await expect(checkTunnelStatus("tunnel-x")).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// listActiveTunnels — server mode
// ---------------------------------------------------------------------------

describe("listActiveTunnels — server mode", () => {
  beforeEach(() => {
    vi.mocked(isServer).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GETs /api/ssh/tunnels and returns the array", async () => {
    vi.stubGlobal("fetch", makeFetch(200, ["tunnel-1", "tunnel-2"]));

    const tunnels = await listActiveTunnels();
    expect(tunnels).toEqual(["tunnel-1", "tunnel-2"]);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/ssh/tunnels");
  });

  it("returns empty array when no tunnels are active", async () => {
    vi.stubGlobal("fetch", makeFetch(200, []));
    expect(await listActiveTunnels()).toEqual([]);
  });
});
