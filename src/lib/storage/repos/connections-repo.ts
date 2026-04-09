import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col, nullable, bool, optBool, safeJsonParse } from "../create-repo";
import type { ColumnDef } from "../create-repo";
import type { PersistedConnection } from "$lib/hooks/database/types";

type ConnectionRow = Omit<PersistedConnection, "labelIds">;

const _connectionRepo = createRepo<ConnectionRow>({
  table: "connections",
  id: "id",
  columns: {
    id: col("id"),
    projectId: col("project_id"),
    name: col("name"),
    type: col("type"),
    host: col("host"),
    port: col("port"),
    databaseName: col("database_name"),
    username: col("username"),
    sslMode: nullable("ssl_mode"),
    connectionString: nullable("connection_string"),
    lastConnected: {
      dbColumn: "last_connected",
      toDb: (v) => (v instanceof Date ? v.toISOString() : (v ?? null)),
      fromDb: (v) => (v ? new Date(v as string) : undefined),
    } as ColumnDef,
    sshTunnel: {
      dbColumn: "ssh_tunnel",
      toDb: (v) => (v ? JSON.stringify(v) : null),
      fromDb: (v) => safeJsonParse(v as string | null, undefined),
    } as ColumnDef,
    savePassword: bool("save_password"),
    saveSshPassword: bool("save_ssh_password"),
    saveSshKeyPassphrase: bool("save_ssh_key_passphrase"),
    isLocalOnly: {
      dbColumn: "is_local_only",
      toDb: (v) => (v ? 1 : 0),
      fromDb: (v) => (v === 1 ? true : undefined),
    } as ColumnDef,
    sharedConnectionId: nullable("shared_connection_id"),
    aiShareSchema: optBool("ai_share_schema"),
    aiShareData: optBool("ai_share_data"),
    activeAIProviderId: nullable("active_ai_provider_id"),
    activeAIModel: nullable("active_ai_model"),
  },
});

export const connectionsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedConnection[]> {
    const rows = await _connectionRepo.loadAll(db);
    const connections: PersistedConnection[] = [];
    for (const row of rows) {
      const labelRows = await db.query<{ label_id: string }>(
        "SELECT label_id FROM connection_labels WHERE connection_id = ?",
        [row.id],
      );
      connections.push({
        ...row,
        labelIds: labelRows.map((l) => l.label_id),
      });
    }
    return connections;
  },

  async save(db: SqliteDatabase, conn: PersistedConnection): Promise<void> {
    const { labelIds, ...base } = conn;
    await _connectionRepo.save(db, base);

    // Replace labels
    await db.execute("DELETE FROM connection_labels WHERE connection_id = ?", [conn.id]);
    for (const labelId of labelIds) {
      await db.execute("INSERT INTO connection_labels (connection_id, label_id) VALUES (?, ?)", [
        conn.id,
        labelId,
      ]);
    }
  },

  async remove(db: SqliteDatabase, connectionId: string): Promise<void> {
    await _connectionRepo.remove(db, connectionId);
  },
};
