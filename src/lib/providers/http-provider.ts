/**
 * HTTP database provider for the self-hosted web version.
 * Implements DatabaseProvider using fetch() for unary operations
 * and WebSocket for streaming queries.
 */

import type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";
import { dedupeColumnNames } from "$lib/utils/row-access";

interface DbError {
  message: string;
  code: string;
}

interface DbConnectResult {
  connection_id: string;
}

interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
}

interface DbExecuteResult {
  rows_affected: number;
  last_insert_id: number | null;
}

function isDbError(error: unknown): error is DbError {
  return typeof error === "object" && error !== null && "message" in error && "code" in error;
}

function formatError(error: unknown): Error {
  if (isDbError(error)) {
    return new Error(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("An unknown error occurred");
}

export class HttpDatabaseProvider implements DatabaseProvider {
  readonly id = "http";
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean {
    return typeof window !== "undefined";
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      throw formatError(data);
    }
    return data as T;
  }

  async connect(config: ConnectionConfig): Promise<string> {
    try {
      const result = await this.post<DbConnectResult>("/api/db/connect", this.toRustConfig(config));
      return result.connection_id;
    } catch (error) {
      throw formatError(error);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    try {
      await this.post<null>("/api/db/disconnect", { connection_id: connectionId });
    } catch (error) {
      throw formatError(error);
    }
  }

  async select<T = Record<string, unknown>>(
    connectionId: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    try {
      const result = await this.post<DbQueryResult>("/api/db/query", {
        connection_id: connectionId,
        sql,
        values: params ?? [],
      });
      // Convert columnar → row objects for frontend compatibility. Dedupe
      // column names first so `SELECT a.id, b.id FROM a JOIN b` preserves
      // both values ({ id: ..., id_2: ... }) instead of the second one
      // silently overwriting the first.
      const columns = dedupeColumnNames(result.columns);
      return result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj as T;
      });
    } catch (error) {
      throw formatError(error);
    }
  }

  async execute(connectionId: string, sql: string, params?: unknown[]): Promise<ExecuteResult> {
    try {
      const result = await this.post<DbExecuteResult>("/api/db/execute", {
        connection_id: connectionId,
        sql,
        values: params ?? [],
      });
      return {
        rowsAffected: result.rows_affected,
        lastInsertId: result.last_insert_id ?? undefined,
      };
    } catch (error) {
      throw formatError(error);
    }
  }

  async test(config: ConnectionConfig): Promise<void> {
    try {
      await this.post<null>("/api/db/test", this.toRustConfig(config));
    } catch (error) {
      throw formatError(error);
    }
  }

  async selectStream(
    connectionId: string,
    sql: string,
    params: unknown[] | undefined,
    onBatch: (batch: {
      columns: string[] | null;
      rows: unknown[][];
      isFinal: boolean;
    }) => boolean | Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<{ aborted: boolean; error?: string }> {
    // If the caller hands us an already-aborted signal, short-circuit entirely.
    if (signal?.aborted) {
      return { aborted: true };
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}${this.baseUrl}/api/db/stream`;
    const queryId = crypto.randomUUID();

    let cancelled = false;
    let cancelSent = false;
    let ws: WebSocket | null = null;

    // Serialize onBatch invocations so we don't interleave async callbacks when
    // batches arrive faster than the caller can process them.
    let processing: Promise<void> = Promise.resolve();
    let terminal: { aborted: boolean; error?: string } | null = null;
    let resolveTerminal: (() => void) | null = null;
    const terminalPromise = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });

    const finish = (value: { aborted: boolean; error?: string }) => {
      if (terminal) return;
      terminal = value;
      resolveTerminal?.();
    };

    // Send cancel once; the server will drain and send Done.
    const sendCancel = () => {
      if (!cancelSent && ws !== null && ws.readyState === WebSocket.OPEN) {
        cancelSent = true;
        ws.send(JSON.stringify({ type: "cancel" }));
      }
    };

    const handleBatchEvent = async (event: {
      columns: string[] | null;
      rows: unknown[][];
      is_final: boolean;
    }) => {
      if (cancelled) return;

      // Rows are already columnar on the wire — forward them straight through.
      const keepGoing = await onBatch({
        columns: event.columns,
        rows: event.rows,
        isFinal: event.is_final,
      });

      if (!keepGoing || signal?.aborted) {
        cancelled = true;
      }

      if (event.is_final) {
        finish({ aborted: cancelled });
      }
    };

    const onAbort = () => {
      cancelled = true;
      sendCancel();
      // Resolve immediately — don't wait for the server to acknowledge.
      finish({ aborted: true });
    };
    // The already-aborted case is handled by the early return above.
    signal?.addEventListener("abort", onAbort);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws!.send(
        JSON.stringify({
          query_id: queryId,
          connection_id: connectionId,
          sql,
          values: params ?? [],
        }),
      );
    };

    ws.onmessage = (event) => {
      // Chain handlers so batches are processed in order.
      processing = processing.then(async () => {
        if (terminal) return;
        try {
          const msg = JSON.parse(String(event.data)) as
            | { type: "batch"; columns: string[] | null; rows: unknown[][]; is_final: boolean }
            | { type: "done" }
            | { type: "error"; message: string; code: string };

          if (msg.type === "batch") {
            await handleBatchEvent(msg);
            // If onBatch asked to stop, tell the server.
            if (cancelled) {
              sendCancel();
            }
          } else if (msg.type === "done") {
            finish({ aborted: cancelled });
          } else if (msg.type === "error") {
            finish({ aborted: false, error: `${msg.code}: ${msg.message}` });
          }
        } catch (e) {
          finish({
            aborted: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    };

    ws.onerror = () => {
      finish({ aborted: false, error: "WebSocket connection error" });
    };

    ws.onclose = (event) => {
      if (!terminal) {
        if (event.wasClean) {
          finish({ aborted: cancelled });
        } else {
          finish({
            aborted: false,
            error: `WebSocket closed unexpectedly (code ${event.code})`,
          });
        }
      }
    };

    try {
      await terminalPromise;
      // Drain pending batch callbacks so the caller observes consistent final state.
      await processing;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      // Close the socket if it's still alive.
      if (ws !== null) {
        const w = ws;
        if (w.readyState !== WebSocket.CLOSED && w.readyState !== WebSocket.CLOSING) {
          w.close();
        }
      }
    }

    return terminal ?? { aborted: cancelled };
  }

  private toRustConfig(config: ConnectionConfig): Record<string, unknown> {
    if (config.type === "mssql") {
      return {
        driver: "mssql",
        host: config.host,
        port: config.port,
        database: config.databaseName,
        username: config.username,
        password: config.password,
        encrypt: config.sslMode !== "disable",
        trust_cert: config.sslMode !== "require",
      };
    }

    if (config.type === "duckdb") {
      const path = config.connectionString
        ? config.connectionString.replace(/^duckdb:\/\//, "").replace(/^duckdb:/, "") || ":memory:"
        : config.databaseName || ":memory:";
      return { driver: "duckdb", path };
    }

    // PostgreSQL, MySQL, MariaDB, SQLite
    return {
      driver: config.type === "mariadb" ? "mysql" : config.type,
      connection_string: config.connectionString,
    };
  }
}
