/**
 * Unified Tauri database provider.
 * Single provider for all database types (PostgreSQL, MySQL, SQLite, MSSQL, DuckDB)
 * via the unified db_connect/db_query/db_execute/db_disconnect/db_test commands.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { DatabaseProvider, ConnectionConfig, ExecuteResult } from "./types";

interface DbConnectResult {
  connection_id: string;
}

interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
}

/**
 * Wire format for streaming events sent back through the Tauri Channel.
 * Matches the Rust `StreamEvent` enum — internally-tagged (`serde(tag = "type")`),
 * which flattens the wrapped `StreamBatch` fields into the event object for the
 * `batch` variant. Variant names are camelCased.
 */
type DbStreamEvent =
  | { type: "batch"; columns: string[] | null; rows: unknown[][]; is_final: boolean }
  | { type: "done" }
  | { type: "error"; message: string; code: string };

interface DbExecuteResult {
  rows_affected: number;
  last_insert_id: number | null;
}

interface DbError {
  message: string;
  code: string;
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

export class UnifiedTauriProvider implements DatabaseProvider {
  readonly id = "unified-tauri";

  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI__" in window;
  }

  async connect(config: ConnectionConfig): Promise<string> {
    try {
      const result = await invoke<DbConnectResult>("db_connect", {
        config: this.toRustConfig(config),
      });
      return result.connection_id;
    } catch (error) {
      throw formatError(error);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    try {
      await invoke("db_disconnect", { connectionId });
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
      const result = await invoke<DbQueryResult>("db_query", {
        connectionId,
        sql,
        values: params ?? [],
      });
      // Convert columnar → row objects for frontend compatibility
      return result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj as T;
      });
    } catch (error) {
      throw formatError(error);
    }
  }

  async selectStream<T = Record<string, unknown>>(
    connectionId: string,
    sql: string,
    params: unknown[] | undefined,
    onBatch: (batch: {
      columns: string[] | null;
      rows: T[];
      isFinal: boolean;
    }) => boolean | Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<{ aborted: boolean; error?: string }> {
    // If the caller hands us an already-aborted signal, short-circuit
    // entirely. The previous behavior was to still fire the invoke and
    // let it run to completion in the background, which wastes a full
    // query's worth of CPU and holds the sqlx connection for no reason.
    if (signal?.aborted) {
      return { aborted: true };
    }

    const channel = new Channel<DbStreamEvent>();
    // Per-call query ID so `db_cancel_stream` can target *this* stream
    // even if several are in flight concurrently across tabs.
    const queryId = crypto.randomUUID();

    // Columns captured from the first batch, reused when later batches carry null
    // and when converting columnar row arrays into row objects.
    let capturedColumns: string[] = [];
    let cancelled = false;

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

    const handleBatchEvent = async (event: {
      columns: string[] | null;
      rows: unknown[][];
      is_final: boolean;
    }) => {
      if (cancelled) return;

      if (event.columns && capturedColumns.length === 0) {
        capturedColumns = event.columns;
      }
      const cols = capturedColumns;
      const rowObjects: T[] = event.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < cols.length; i++) {
          obj[cols[i]] = row[i];
        }
        return obj as T;
      });

      const keepGoing = await onBatch({
        columns: event.columns,
        rows: rowObjects,
        isFinal: event.is_final,
      });

      if (!keepGoing || signal?.aborted) {
        cancelled = true;
      }

      if (event.is_final) {
        finish({ aborted: cancelled });
      }
    };

    channel.onmessage = (event) => {
      // Chain handlers so batches are processed in order. Errors in a handler
      // propagate to the terminal promise below via `finish(...)`.
      processing = processing.then(async () => {
        if (terminal) return;
        try {
          if (event.type === "batch") {
            await handleBatchEvent(event);
          } else if (event.type === "done") {
            finish({ aborted: cancelled });
          } else if (event.type === "error") {
            finish({
              aborted: false,
              error: `${event.code}: ${event.message}`,
            });
          }
        } catch (e) {
          finish({
            aborted: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    };

    const onAbort = () => {
      cancelled = true;
      // Tell Rust to stop fetching rows. Fire-and-forget — if it fails
      // (e.g. the stream already finished naturally), we don't care.
      void invoke("db_cancel_stream", { queryId }).catch(() => {});
      // Resolve the terminal promise immediately so selectStream returns
      // without waiting for the invoke to wind down. Rust will catch up
      // on its next loop iteration and the still-pending invoke will
      // eventually resolve in the background.
      finish({ aborted: true });
    };
    // The already-aborted case is handled by the early return at the top
    // of this method; here we only need to listen for a mid-stream abort.
    signal?.addEventListener("abort", onAbort);

    // Kick off the invoke. We do NOT include it in the await below — if
    // the user cancels, we return as soon as `terminal` is set and let
    // the invoke resolve in the background. The `.catch` prevents an
    // unhandled rejection if Rust errors out.
    const invokePromise = invoke<void>("db_query_stream", {
      queryId,
      connectionId,
      sql,
      values: params ?? [],
      onEvent: channel,
    }).catch((error) => {
      finish({
        aborted: false,
        error: formatError(error).message,
      });
    });

    try {
      await terminalPromise;
      // Drain any pending batch callbacks so the caller observes a
      // consistent final state before we resolve.
      await processing;
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }

    // Keep a reference to the invoke promise alive so the Channel isn't
    // GC'd mid-flight if Rust is still wrapping up. The await below
    // resolves almost immediately in the normal case (invoke returns
    // right after Done) and within a loop iteration in the cancel case
    // (Rust sees the flag and breaks out).
    void invokePromise;

    return terminal ?? { aborted: cancelled };
  }

  async execute(connectionId: string, sql: string, params?: unknown[]): Promise<ExecuteResult> {
    try {
      const result = await invoke<DbExecuteResult>("db_execute", {
        connectionId,
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
      await invoke("db_test", { config: this.toRustConfig(config) });
    } catch (error) {
      throw formatError(error);
    }
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
