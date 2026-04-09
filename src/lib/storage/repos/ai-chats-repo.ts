import type { SqliteDatabase } from "../sqlite-types";
import { createRepo, col, nullable } from "../create-repo";
import type { PersistedAIChat, PersistedAIMessage } from "$lib/types";

const _chatRepo = createRepo<PersistedAIChat>({
  table: "ai_chats",
  id: "id",
  columns: {
    id: col("id"),
    connectionId: col("connection_id"),
    title: col("title"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
  },
});

const _messageRepo = createRepo<PersistedAIMessage>({
  table: "ai_messages",
  id: "id",
  columns: {
    id: col("id"),
    chatId: col("chat_id"),
    role: col("role"),
    content: col("content"),
    timestamp: col("timestamp"),
    query: nullable("query"),
    dashboardId: nullable("dashboard_id"),
  },
});

export const aiChatsRepo = {
  async loadByConnection(db: SqliteDatabase, connectionId: string): Promise<PersistedAIChat[]> {
    const rows = await db.query(
      "SELECT * FROM ai_chats WHERE connection_id = ? ORDER BY updated_at DESC",
      [connectionId],
    );
    return rows.map((r) => _chatRepo.mapRow(r as Record<string, unknown>));
  },

  saveChat(db: SqliteDatabase, chat: PersistedAIChat): Promise<void> {
    return _chatRepo.save(db, chat);
  },

  removeChat(db: SqliteDatabase, chatId: string): Promise<void> {
    return _chatRepo.remove(db, chatId);
  },

  removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    return _chatRepo.removeBy(db, "connection_id = ?", [connectionId]);
  },

  async loadMessages(db: SqliteDatabase, chatId: string): Promise<PersistedAIMessage[]> {
    const rows = await db.query(
      "SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY timestamp ASC",
      [chatId],
    );
    return rows.map((r) => _messageRepo.mapRow(r as Record<string, unknown>));
  },

  async replaceAllMessages(
    db: SqliteDatabase,
    chatId: string,
    messages: PersistedAIMessage[],
  ): Promise<void> {
    const statements: Array<{ sql: string; params?: unknown[] }> = [
      { sql: `DELETE FROM ai_messages WHERE chat_id = ?`, params: [chatId] },
    ];
    for (const m of messages) {
      statements.push({ sql: _messageRepo.insertSql, params: _messageRepo.toParams(m) });
    }
    await db.transaction(statements);
  },
};
