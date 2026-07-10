/**
 * Auth API — login/logout against the self-hosted server.
 */

import { setAuthToken, clearAuthToken } from "./token";

export async function login(password: string): Promise<boolean> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { token: string };
  setAuthToken(data.token);
  return true;
}

export function logout(): void {
  clearAuthToken();
}
