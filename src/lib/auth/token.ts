/**
 * Auth token storage utilities for the self-hosted web app.
 * Tokens and user metadata are stored in localStorage and attached to
 * all API requests.
 */

const TOKEN_KEY = "seaquel_auth_token";
const USER_KEY = "seaquel_auth_user";
const ROLE_KEY = "seaquel_auth_role";

export function getAuthToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

/** Store the authenticated user's username + role alongside the token. */
export function setAuthUser(username: string, role: string): void {
  localStorage.setItem(USER_KEY, username);
  localStorage.setItem(ROLE_KEY, role);
}

export function getAuthUser(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(USER_KEY);
}

export function getAuthRole(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ROLE_KEY);
}

export function isAdmin(): boolean {
  return getAuthRole() === "admin";
}

/**
 * Returns Authorization headers object for fetch calls.
 * Empty object when not authenticated (login endpoint doesn't need it).
 */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Returns the token as a query string for WebSocket connections.
 * Empty string when not authenticated.
 */
export function authTokenQuery(): string {
  const token = getAuthToken();
  return token ? `token=${encodeURIComponent(token)}` : "";
}
