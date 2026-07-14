import { describe, it, expect, beforeEach } from "vitest";
import {
  getAuthToken,
  setAuthToken,
  setAuthUser,
  getAuthUser,
  getAuthRole,
  isAdmin,
  clearAuthToken,
} from "./token";

/** Build a token matching the server format: base64url(json).signature */
function makeToken(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(json);
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url}.fakesig`;
}

beforeEach(() => {
  localStorage.clear();
});

describe("getAuthUser", () => {
  it("returns the username from localStorage when set by setAuthUser", () => {
    setAuthToken("tok");
    setAuthUser("alice", "editor");
    expect(getAuthUser()).toBe("alice");
  });

  it("falls back to token payload when localStorage user key is missing", () => {
    const token = makeToken({ exp: 9999, sid: "s1", user: "bob", role: "admin" });
    setAuthToken(token);
    expect(getAuthUser()).toBe("bob");
  });

  it("returns null when neither localStorage nor token has a user", () => {
    expect(getAuthUser()).toBeNull();
  });
});

describe("getAuthRole", () => {
  it("returns the role from localStorage when set by setAuthUser", () => {
    setAuthToken("tok");
    setAuthUser("alice", "editor");
    expect(getAuthRole()).toBe("editor");
  });

  it("falls back to token payload when localStorage role key is missing", () => {
    const token = makeToken({ exp: 9999, sid: "s1", user: "admin", role: "admin" });
    setAuthToken(token);
    expect(getAuthRole()).toBe("admin");
    expect(isAdmin()).toBe(true);
  });

  it("returns null when neither localStorage nor token has a role", () => {
    expect(getAuthRole()).toBeNull();
    expect(isAdmin()).toBe(false);
  });

  it("prefers localStorage role over token payload", () => {
    const token = makeToken({ exp: 9999, sid: "s1", user: "u", role: "viewer" });
    setAuthToken(token);
    setAuthUser("u", "admin"); // localStorage says admin
    expect(getAuthRole()).toBe("admin");
  });
});

describe("clearAuthToken", () => {
  it("removes token, user, and role from localStorage", () => {
    setAuthToken("tok");
    setAuthUser("alice", "admin");
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
    expect(getAuthUser()).toBeNull();
    expect(getAuthRole()).toBeNull();
  });
});
