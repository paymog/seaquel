import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Provider factory tests — verify environment dispatch
// ---------------------------------------------------------------------------

// We mock environment detection and all three provider modules so the tests
// run without Tauri APIs, DuckDB WASM, or a live HTTP server.

vi.mock("$lib/utils/environment", () => ({
  isTauri: vi.fn(() => false),
  isServer: vi.fn(() => false),
}));

// Minimal stub classes that satisfy instanceof checks
class StubTauriProvider {}
class StubHttpProvider {}
class StubDuckDBProvider {}

vi.mock("./unified-tauri-provider", () => ({
  UnifiedTauriProvider: StubTauriProvider,
}));
vi.mock("./http-provider", () => ({
  HttpDatabaseProvider: StubHttpProvider,
}));
vi.mock("./duckdb-provider", () => ({
  DuckDBProvider: StubDuckDBProvider,
}));

import * as env from "$lib/utils/environment";

describe("getProvider", () => {
  beforeEach(async () => {
    // Reset module-level cached provider between tests
    const mod = await import("./index");
    mod.resetProvider();
    vi.mocked(env.isTauri).mockReturnValue(false);
    vi.mocked(env.isServer).mockReturnValue(false);
  });

  it("returns UnifiedTauriProvider when isTauri() is true", async () => {
    vi.mocked(env.isTauri).mockReturnValue(true);
    const { getProvider } = await import("./index");
    const p = await getProvider();
    expect(p).toBeInstanceOf(StubTauriProvider);
  });

  it("returns HttpDatabaseProvider when isServer() is true", async () => {
    vi.mocked(env.isServer).mockReturnValue(true);
    const { getProvider } = await import("./index");
    const p = await getProvider();
    expect(p).toBeInstanceOf(StubHttpProvider);
  });

  it("returns DuckDBProvider in demo mode (not Tauri, not server)", async () => {
    const { getProvider } = await import("./index");
    const p = await getProvider();
    expect(p).toBeInstanceOf(StubDuckDBProvider);
  });

  it("caches the provider across calls", async () => {
    const { getProvider } = await import("./index");
    const p1 = await getProvider();
    const p2 = await getProvider();
    expect(p1).toBe(p2);
  });
});

describe("getDuckDBProvider", () => {
  beforeEach(async () => {
    const mod = await import("./index");
    mod.resetProvider();
    vi.mocked(env.isTauri).mockReturnValue(false);
    vi.mocked(env.isServer).mockReturnValue(false);
  });

  it("returns UnifiedTauriProvider when isTauri() is true", async () => {
    vi.mocked(env.isTauri).mockReturnValue(true);
    const { getDuckDBProvider } = await import("./index");
    const p = await getDuckDBProvider();
    expect(p).toBeInstanceOf(StubTauriProvider);
  });

  it("returns HttpDatabaseProvider when isServer() is true", async () => {
    vi.mocked(env.isServer).mockReturnValue(true);
    const { getDuckDBProvider } = await import("./index");
    const p = await getDuckDBProvider();
    expect(p).toBeInstanceOf(StubHttpProvider);
  });

  it("returns DuckDBProvider in demo mode", async () => {
    const { getDuckDBProvider } = await import("./index");
    const p = await getDuckDBProvider();
    expect(p).toBeInstanceOf(StubDuckDBProvider);
  });
});

describe("isDemo (re-exported from index)", () => {
  beforeEach(async () => {
    vi.mocked(env.isTauri).mockReturnValue(false);
    vi.mocked(env.isServer).mockReturnValue(false);
  });

  it("returns true when not Tauri and not server", async () => {
    const { isDemo } = await import("./index");
    expect(isDemo()).toBe(true);
  });

  it("returns false when isTauri() is true", async () => {
    vi.mocked(env.isTauri).mockReturnValue(true);
    const { isDemo } = await import("./index");
    expect(isDemo()).toBe(false);
  });

  it("returns false when isServer() is true", async () => {
    vi.mocked(env.isServer).mockReturnValue(true);
    const { isDemo } = await import("./index");
    expect(isDemo()).toBe(false);
  });
});
