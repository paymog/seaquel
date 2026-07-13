/**
 * Server-side connection storage for the self-hosted web app.
 * Replaces the browser SQLite (sql.js) connection store with HTTP calls
 * to the Rust backend's `/api/connections` endpoints.
 *
 * Passwords are NOT stored here — they go through the KeyringService
 * (ServerKeyringService → `/api/secrets`), exactly as on desktop.
 */

import { authHeaders } from "$lib/auth/token";
import type { PersistedConnection } from "$lib/hooks/database/types";
import { log } from "$lib/utils/logger";

/**
 * Fetch all connections from the server.
 */
export async function serverLoadConnections(): Promise<PersistedConnection[]> {
  const res = await fetch("/api/connections", { headers: authHeaders() });
  if (!res.ok) {
    void log.error(`serverLoadConnections: ${res.status} ${res.statusText}`);
    return [];
  }
  const data = (await res.json()) as Record<string, unknown>[];
  // The server stores opaque JSON objects; normalize to PersistedConnection.
  return data.map(normalizeConnection);
}

/**
 * Save (upsert) a connection to the server.
 */
export async function serverSaveConnection(conn: PersistedConnection): Promise<void> {
  const res = await fetch("/api/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(conn),
  });
  if (!res.ok) {
    throw new Error(`serverSaveConnection: ${res.status} ${res.statusText}`);
  }
}

/**
 * Delete a connection from the server by id.
 */
export async function serverDeleteConnection(connectionId: string): Promise<void> {
  const res = await fetch(`/api/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`serverDeleteConnection: ${res.status} ${res.statusText}`);
  }
}

/**
 * Coerce the server's opaque JSON into a `PersistedConnection`.
 * The server is a transparent passthrough, so the shape matches what the
 * frontend sent — this just handles `lastConnected` deserialization and
 * fills defaults for any missing optional fields.
 */
function normalizeConnection(raw: Record<string, unknown>): PersistedConnection {
  return {
    id: raw.id as string,
    name: raw.name as string,
    type: raw.type as PersistedConnection["type"],
    host: raw.host as string,
    port: raw.port as number,
    databaseName: raw.databaseName as string,
    username: raw.username as string,
    sslMode: raw.sslMode as string | undefined,
    connectionString: raw.connectionString as string | undefined,
    lastConnected: raw.lastConnected ? new Date(raw.lastConnected as string) : undefined,
    sshTunnel: raw.sshTunnel as PersistedConnection["sshTunnel"],
    savePassword: raw.savePassword as boolean | undefined,
    saveSshPassword: raw.saveSshPassword as boolean | undefined,
    saveSshKeyPassphrase: raw.saveSshKeyPassphrase as boolean | undefined,
    projectId: (raw.projectId as string) ?? "default",
    labelIds: (raw.labelIds as string[]) ?? [],
    isLocalOnly: raw.isLocalOnly as boolean | undefined,
    sharedConnectionId: raw.sharedConnectionId as string | undefined,
    aiShareSchema: raw.aiShareSchema as boolean | undefined,
    aiShareData: raw.aiShareData as boolean | undefined,
    activeAIProviderId: raw.activeAIProviderId as string | undefined,
    activeAIModel: raw.activeAIModel as string | undefined,
  };
}
