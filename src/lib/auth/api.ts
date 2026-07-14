/**
 * Auth API — login/logout against the self-hosted server.
 */

import { setAuthToken, clearAuthToken, setAuthUser } from "./token";

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    return { ok: false, error: res.status === 401 ? "Invalid username or password" : undefined };
  }
  const data = (await res.json()) as { token: string; username: string; role: string };
  setAuthToken(data.token);
  setAuthUser(data.username, data.role);
  return { ok: true };
}

export function logout(): void {
  clearAuthToken();
}
