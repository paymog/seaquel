# Seaquel Web Epic — Shared Architecture Context

## Goal
Turn the Tauri desktop DB client into a self-hostable web app: browser → backend server → databases.
Hosted internally behind Cloudflare Zero Trust. Commit directly to main (no PRs).

## Key Architecture Seams (already exist)

### 1. DatabaseProvider interface (`src/lib/providers/types.ts`)
6 methods: `connect`, `disconnect`, `select`, `selectStream`, `execute`, `test`.
- `connect(config: ConnectionConfig): Promise<string>` — returns connectionId
- `disconnect(connectionId): Promise<void>`
- `select<T>(connectionId, sql, params?): Promise<T[]>` — columnar→row objects
- `selectStream(connectionId, sql, params, onBatch, signal?): Promise<{aborted, error?}>`
- `execute(connectionId, sql, params?): Promise<ExecuteResult>`
- `test(config): Promise<void>`

### 2. Rust DB engine (`src-tauri/src/db/mod.rs`) — TAURI-FREE
- `ConnectionManager`: holds `RwLock<HashMap<String, Box<dyn Driver>>>` + `cancellation_flags`
- `Driver` trait: `query`, `execute`, `transaction`, `query_stream`, `close`
- 5 drivers: Postgres, MySQL, SQLite (sqlx), MSSQL (tiberius), DuckDB
- Types: `ConnectConfig`, `QueryResult`, `StreamBatch`, `ExecuteResult`, `ConnectResult`, `DbError`
- `DbError { message, code }` — this is the wire error format the frontend parses

### 3. `db/commands.rs` — TAURI-DEPENDENT (thin wrappers)
`StreamEvent` enum (Batch/Done/Error) — serde only, no Tauri types.
Command functions: `db_connect`, `db_query`, `db_query_stream`, `db_cancel_stream`, `db_execute`, `db_transaction`, `db_disconnect`, `db_test`.
These use `#[tauri::command]`, `tauri::State`, `tauri::ipc::Channel`.

### 4. Provider factory (`src/lib/providers/index.ts`)
```ts
if (isTauri()) → UnifiedTauriProvider
else → DuckDBProvider (browser demo)
```
`isTauri()` checks `window.__TAURI_INTERNALS__` / `window.__TAURI__` / `tauri:` protocol.

### 5. UnifiedTauriProvider (`src/lib/providers/unified-tauri-provider.ts`)
Mirrors invoke() calls to Rust commands. The HTTP provider should mirror this structure.
Key: `toRustConfig()` maps frontend `ConnectionConfig` → Rust `ConnectConfig`.
Error format: `{code, message}` → `new Error("${code}: ${message}")`

### 6. StorageProvider (`src/lib/storage/types.ts`)
`Store` interface: get/set/save/clear/delete. Implementations: tauri-sqlite, web-sqlite.

### 7. KeyringService (`src/lib/services/keyring.ts`)
Interface for OS keyring. `TauriKeyringService` (desktop) + `NoopKeyringService` (demo).

### 8. SSH Tunnel (`src-tauri/src/ssh_tunnel.rs` + `src/lib/services/ssh-tunnel.ts`)
Rust: `TunnelManager`, `TunnelConfig`, `TunnelResult`, uses russh.
Frontend: `createSshTunnel`/`closeSshTunnel` → invoke().

## Cargo.toml Structure
- Single crate `seaquel` with lib name `seaquel_lib`, crate-type `["staticlib", "cdylib", "rlib"]`
- Tauri is a non-optional dependency
- `db` module is Tauri-free; `git`, `license`, `logging`, `ssh_tunnel` modules use Tauri

## Build System
- `package.json`: `build:demo` = `BUILD_TARGET=demo vite build --mode demo`
- `vite.config.js`: checks `BUILD_TARGET === "demo"`
- `svelte.config.js`: adapter-static, fallback `index.html`, output to `build` or `build-demo`
- No vitest configured (no test runner for TS)

## Conventions
- Error toast: use `errorToast` from `$lib/utils/toast`
- Svelte 5 runes (`$state`, `$derived`, `$props`)
- oxlint for linting, oxfmt for formatting
- CLAUDE.md says "Never commit" — OVERRIDDEN by user instruction to commit directly to main
