/**
 * User management API client (admin only).
 */

import { authHeaders } from "./token";

export interface User {
  username: string;
  role: string;
}

export async function listUsers(): Promise<User[]> {
  const res = await fetch("/api/users", { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to list users");
  return res.json();
}

export async function createUser(
  username: string,
  password: string,
  role: string,
): Promise<User> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ username, password, role }),
  });
  if (res.status === 409) throw new Error("Username already exists");
  if (!res.ok) throw new Error("Failed to create user");
  return res.json();
}

export async function updateUser(
  username: string,
  updates: { password?: string; role?: string },
): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update user");
}

export async function deleteUser(username: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete user");
}
