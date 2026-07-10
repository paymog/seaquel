import { describe, it, expect, vi, afterEach } from "vitest";
import { isTauri, isServer, isDemo, isBrowser } from "./environment";

// Extend Window to allow Tauri marker properties in tests
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

describe("isBrowser", () => {
  it("returns true when window is defined (jsdom)", () => {
    expect(isBrowser()).toBe(true);
  });
});

describe("isTauri", () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI__;
  });

  it("returns false when no Tauri markers are present", () => {
    expect(isTauri()).toBe(false);
  });

  it("returns true when __TAURI_INTERNALS__ is present", () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});

describe("isServer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__TAURI_INTERNALS__;
  });

  it("returns false when VITE_IS_SERVER is not set", () => {
    expect(isServer()).toBe(false);
  });

  it('returns false when VITE_IS_SERVER is "false"', () => {
    vi.stubEnv("VITE_IS_SERVER", "false");
    expect(isServer()).toBe(false);
  });

  it('returns true when VITE_IS_SERVER is "true"', () => {
    // vi.stubEnv sets string values; the function accepts "true" || true
    vi.stubEnv("VITE_IS_SERVER", "true");
    expect(isServer()).toBe(true);
  });

  it("returns false when isTauri() is true even if VITE_IS_SERVER is set", () => {
    vi.stubEnv("VITE_IS_SERVER", "true");
    window.__TAURI_INTERNALS__ = {};
    expect(isServer()).toBe(false);
  });
});

describe("isDemo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__TAURI_INTERNALS__;
  });

  it("returns true in plain browser (not Tauri, not server)", () => {
    expect(isDemo()).toBe(true);
  });

  it("returns false when running as server", () => {
    vi.stubEnv("VITE_IS_SERVER", "true");
    expect(isDemo()).toBe(false);
  });

  it("returns false when running in Tauri", () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isDemo()).toBe(false);
  });
});
