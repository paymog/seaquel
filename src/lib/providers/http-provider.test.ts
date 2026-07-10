import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpDatabaseProvider } from "./http-provider";
import type { ConnectionConfig } from "./types";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** Simulates the connection opening. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Simulates a text message arriving. */
  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  /** Simulates the socket closing (e.g. after Done or server close). */
  simulateClose(wasClean = true, code = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { wasClean, code }));
  }

  /** Simulates a WebSocket error. */
  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  /** close() called by the provider for cleanup — just sets readyState. */
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HttpDatabaseProvider", () => {
  let provider: HttpDatabaseProvider;
  let wsInstance: MockWebSocket | null;

  beforeEach(() => {
    provider = new HttpDatabaseProvider();
    wsInstance = null;

    // Each test gets a fresh WebSocket constructor that captures the instance.
    const Ctor = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        wsInstance = this;
      }
    };
    vi.stubGlobal("WebSocket", Ctor);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  it("connect: posts to /api/db/connect and returns connection_id", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { connection_id: "pg-abc123" }));

    const config: ConnectionConfig = {
      type: "postgres",
      databaseName: "mydb",
      connectionString: "postgres://localhost/mydb",
    };
    const id = await provider.connect(config);

    expect(id).toBe("pg-abc123");
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/db/connect");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toMatchObject({ driver: "postgres", connection_string: "postgres://localhost/mydb" });
  });

  it("connect: throws formatted error on HTTP error response", async () => {
    vi.stubGlobal("fetch", makeFetch(500, { message: "connection refused", code: "DB_ERROR" }));

    await expect(
      provider.connect({ type: "postgres", databaseName: "x" }),
    ).rejects.toThrow("DB_ERROR: connection refused");
  });

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  it("disconnect: posts connection_id to /api/db/disconnect", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.disconnect("conn-1");

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/db/disconnect");
    const body = JSON.parse(init.body as string) as { connection_id: string };
    expect(body.connection_id).toBe("conn-1");
  });

  // -------------------------------------------------------------------------
  // select
  // -------------------------------------------------------------------------

  it("select: converts columnar response to row objects", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(200, { columns: ["id", "name"], rows: [[1, "Alice"], [2, "Bob"]] }),
    );

    const rows = await provider.select("conn-1", "SELECT id, name FROM users");

    expect(rows).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("select: deduplicates column names", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(200, { columns: ["id", "id"], rows: [[1, 2]] }),
    );

    const rows = await provider.select("conn-1", "SELECT a.id, b.id FROM a JOIN b ON true");

    expect(rows).toEqual([{ id: 1, id_2: 2 }]);
  });

  it("select: posts correct body to /api/db/query", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { columns: ["n"], rows: [[42]] }));

    await provider.select("conn-1", "SELECT $1::int AS n", [42]);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/db/query");
    const body = JSON.parse(init.body as string) as { connection_id: string; sql: string; values: unknown[] };
    expect(body).toMatchObject({ connection_id: "conn-1", sql: "SELECT $1::int AS n", values: [42] });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  it("execute: parses rows_affected and last_insert_id", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { rows_affected: 3, last_insert_id: 99 }));

    const result = await provider.execute("conn-1", "INSERT INTO t VALUES ($1)", ["v"]);

    expect(result.rowsAffected).toBe(3);
    expect(result.lastInsertId).toBe(99);
  });

  it("execute: last_insert_id null → lastInsertId undefined", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { rows_affected: 1, last_insert_id: null }));

    const result = await provider.execute("conn-1", "DELETE FROM t");

    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // test
  // -------------------------------------------------------------------------

  it("test: resolves on 200", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await expect(provider.test({ type: "postgres", databaseName: "x" })).resolves.toBeUndefined();
  });

  it("test: throws on error response", async () => {
    vi.stubGlobal("fetch", makeFetch(400, { message: "bad credentials", code: "AUTH_FAILED" }));

    await expect(
      provider.test({ type: "mysql", databaseName: "db", username: "u", password: "p" }),
    ).rejects.toThrow("AUTH_FAILED: bad credentials");
  });

  // -------------------------------------------------------------------------
  // toRustConfig (tested via connect/test body inspection)
  // -------------------------------------------------------------------------

  it("toRustConfig: mssql branch", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    const config: ConnectionConfig = {
      type: "mssql",
      host: "sqlserver.example.com",
      port: 1433,
      databaseName: "MyDB",
      username: "sa",
      password: "secret",
      sslMode: "require",
    };
    await provider.test(config);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      driver: "mssql",
      host: "sqlserver.example.com",
      port: 1433,
      database: "MyDB",
      username: "sa",
      password: "secret",
      encrypt: true,
      trust_cert: false,
    });
  });

  it("toRustConfig: duckdb with connection string", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.test({ type: "duckdb", databaseName: "", connectionString: "duckdb:///data/mydb.duckdb" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ driver: "duckdb", path: "/data/mydb.duckdb" });
  });

  it("toRustConfig: duckdb memory fallback", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.test({ type: "duckdb", databaseName: "" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ driver: "duckdb", path: ":memory:" });
  });

  it("toRustConfig: postgres with connection string", async () => {
    vi.stubGlobal("fetch", makeFetch(200, { connection_id: "c1" }));

    await provider.connect({ type: "postgres", databaseName: "pg", connectionString: "postgres://host/pg" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ driver: "postgres", connection_string: "postgres://host/pg" });
  });

  it("toRustConfig: mysql branch", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.test({ type: "mysql", databaseName: "db", connectionString: "mysql://host/db" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ driver: "mysql" });
  });

  it("toRustConfig: mariadb maps to mysql driver", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.test({ type: "mariadb", databaseName: "db", connectionString: "mysql://host/db" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ driver: "mysql" });
  });

  it("toRustConfig: sqlite branch", async () => {
    vi.stubGlobal("fetch", makeFetch(200, null));

    await provider.test({ type: "sqlite", databaseName: "/tmp/db.sqlite" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ driver: "sqlite" });
  });

  // -------------------------------------------------------------------------
  // selectStream — basic flow
  // -------------------------------------------------------------------------

  it("selectStream: sends initial message on open, calls onBatch, resolves on done", async () => {
    const batches: unknown[] = [];
    const onBatch = vi.fn().mockImplementation((b: unknown) => {
      batches.push(b);
      return true;
    });

    const streamPromise = provider.selectStream("conn-1", "SELECT 1", [], onBatch);

    // The WebSocket must have been created
    expect(wsInstance).not.toBeNull();
    const ws = wsInstance!;

    ws.simulateOpen();

    // Initial message should have been sent
    expect(ws.sent).toHaveLength(1);
    const initMsg = JSON.parse(ws.sent[0]) as Record<string, unknown>;
    expect(initMsg).toMatchObject({
      connection_id: "conn-1",
      sql: "SELECT 1",
      values: [],
    });
    expect(typeof initMsg.query_id).toBe("string");

    // Server sends a batch then done
    ws.simulateMessage({ type: "batch", columns: ["n"], rows: [[1]], is_final: false });
    ws.simulateMessage({ type: "done" });

    const result = await streamPromise;

    expect(result).toEqual({ aborted: false });
    expect(onBatch).toHaveBeenCalledOnce();
    expect(batches[0]).toMatchObject({ columns: ["n"], rows: [[1]], isFinal: false });
  });

  it("selectStream: resolves with error on error message", async () => {
    const onBatch = vi.fn().mockReturnValue(true);
    const streamPromise = provider.selectStream("conn-1", "SELECT bad", [], onBatch);

    const ws = wsInstance!;
    ws.simulateOpen();
    ws.simulateMessage({ type: "error", message: "syntax error", code: "SQL_ERROR" });

    const result = await streamPromise;

    expect(result).toEqual({ aborted: false, error: "SQL_ERROR: syntax error" });
    expect(onBatch).not.toHaveBeenCalled();
  });

  it("selectStream: resolves with error on unexpected WebSocket close", async () => {
    const onBatch = vi.fn().mockReturnValue(true);
    const streamPromise = provider.selectStream("conn-1", "SELECT 1", [], onBatch);

    const ws = wsInstance!;
    ws.simulateOpen();
    ws.simulateClose(false, 1006); // non-clean close

    const result = await streamPromise;

    expect(result.aborted).toBe(false);
    expect(result.error).toMatch(/1006/);
  });

  it("selectStream: early return if signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await provider.selectStream("conn-1", "SELECT 1", undefined, vi.fn(), controller.signal);

    expect(result).toEqual({ aborted: true });
    // No WebSocket should have been created
    expect(wsInstance).toBeNull();
  });

  // -------------------------------------------------------------------------
  // selectStream — cancellation
  // -------------------------------------------------------------------------

  it("selectStream: sends cancel on AbortSignal abort, resolves aborted:true", async () => {
    const controller = new AbortController();
    const onBatch = vi.fn().mockReturnValue(true);

    const streamPromise = provider.selectStream("conn-1", "SELECT 1", [], onBatch, controller.signal);

    const ws = wsInstance!;
    ws.simulateOpen();
    ws.simulateMessage({ type: "batch", columns: ["n"], rows: [[1]], is_final: false });

    // Abort mid-stream
    controller.abort();

    const result = await streamPromise;

    expect(result).toEqual({ aborted: true });
    // Cancel message should have been sent
    const cancelMessages = ws.sent.filter((m) => {
      const parsed = JSON.parse(m) as { type?: string };
      return parsed.type === "cancel";
    });
    expect(cancelMessages).toHaveLength(1);
  });

  it("selectStream: sends cancel when onBatch returns false", async () => {
    const onBatch = vi.fn().mockReturnValue(false);

    const streamPromise = provider.selectStream("conn-1", "SELECT 1", [], onBatch);

    const ws = wsInstance!;
    ws.simulateOpen();
    ws.simulateMessage({ type: "batch", columns: ["n"], rows: [[1]], is_final: false });
    // After returning false, cancel is sent; server then sends done
    ws.simulateMessage({ type: "done" });

    const result = await streamPromise;

    expect(result).toEqual({ aborted: true });
    const cancelMessages = ws.sent.filter((m) => {
      const parsed = JSON.parse(m) as { type?: string };
      return parsed.type === "cancel";
    });
    expect(cancelMessages).toHaveLength(1);
  });

  it("selectStream: cancel sent only once on double abort", async () => {
    const controller = new AbortController();
    const onBatch = vi.fn().mockReturnValue(false); // also returns false

    const streamPromise = provider.selectStream("conn-1", "SELECT 1", [], onBatch, controller.signal);

    const ws = wsInstance!;
    ws.simulateOpen();
    ws.simulateMessage({ type: "batch", columns: ["n"], rows: [[1]], is_final: false });

    controller.abort(); // abort fires concurrently with onBatch returning false

    ws.simulateMessage({ type: "done" });

    await streamPromise;

    const cancelCount = ws.sent.filter((m) => {
      const parsed = JSON.parse(m) as { type?: string };
      return parsed.type === "cancel";
    }).length;
    expect(cancelCount).toBe(1);
  });
});
