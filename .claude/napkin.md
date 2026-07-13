# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-07-13 | user | Repaired the SeaQuel image from a temporary clone instead of the user's existing checkout | Make source changes in `/Users/paymahn/code/seaquel` (`../../seaquel` from infra2); use temporary clones only when no local checkout exists. |
| 2026-07-13 | self | Left the local SeaQuel smoke container running, so test-image cleanup failed | Track each detached smoke container and stop it immediately after the final assertion. |
| 2026-07-13 | self | Created a git worktree for feature work but ran all edits against the main checkout path (`~/code/seaquel/...`); the worktree stayed clean and the main tree collected the diff | When working in a worktree, every tool path must point INTO the worktree dir (`~/code/seaquel/.worktrees/<name>/...`). Verify with `git status` in the worktree after the first edit. |

## User Preferences
- Keep feature work on meaningful branches.

## Patterns That Work
- Smoke-test published container images on every advertised architecture before consuming them.

## Patterns That Don't Work
- Compiling Linux binaries on a newer host glibc and packaging them in an older runtime image.

## Domain Notes
- The self-hosted SeaQuel server listens on port 3000 and uses `SEAQUEL_ADMIN_PASSWORD` for its shared admin login.
- Connection form: structured fields (Host/Port/Database/Username) are the source of truth. `getConnectionData` in `src/lib/utils/connection-string.ts` must rebuild the connection string from those fields — a stale pasted `formData.connectionString` (seeded by `parseConnectionString` in the method step) otherwise wins and can drop the database, so Postgres falls back to using the username as the db name.
- `ServerKeyringService` (self-hosted web mode) is backed by the Rust server's `SecretStore` — AES-256-GCM encrypted, file-persisted to `$SEAQUEL_DATA_DIR/secrets.json`, gated behind the bearer-token auth. `isAvailable()` returns true so the UI offers "save password in keychain"; DB/SSH passwords are stored server-side and survive restarts (when `SEAQUEL_SECRET_KEY` is set).
- In self-hosted web mode (`isServer()`), connection metadata is stored server-side via `GET/POST/DELETE /api/connections` (Rust `ConnectionStore` → `$SEAQUEL_DATA_DIR/connections.json`), NOT in browser localStorage. `PersistenceManager` branches on `isServer()` for `persistConnection`, `removePersistedConnection`, and `loadPersistedConnections`. Passwords flow through the keyring as before. The Rust server stores connection objects as opaque JSON keyed by their `id` field.
- Postgres has no in-connection `USE <db>`; switching logical databases in a cluster requires a new physical connection. `ConnectionManager.switchDatabase` does this by calling `reconnect({ reuseExistingTunnel: true })` with a db-swapped connection string, reusing the live SSH tunnel (the forward targets host:port, database-independent). `reconnect`'s `updatedConnection` must propagate `connection.databaseName` (it spreads `existingConnection`, which otherwise keeps the stale old db name).
- Worktree setup for this repo: the paraglide `src/lib/paraglide/` dir is fully gitignored (auto-generated), so a fresh worktree fails `npm run check` with 94 "Cannot find module $lib/paraglide" errors until you symlink/copy it (and `node_modules`) from the main checkout.
