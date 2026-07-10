/**
 * Auth token storage utilities for the self-hosted web app.
 * Tokens are stored in localStorage and attached to all API requests.
 */

const TOKEN_KEY = "seaquel_auth_token";

export function getAuthToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAuthToken();
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
