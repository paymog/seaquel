# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-07-13 | user | Repaired the SeaQuel image from a temporary clone instead of the user's existing checkout | Make source changes in `/Users/paymahn/code/seaquel` (`../../seaquel` from infra2); use temporary clones only when no local checkout exists. |
| 2026-07-13 | self | Left the local SeaQuel smoke container running, so test-image cleanup failed | Track each detached smoke container and stop it immediately after the final assertion. |
| 2026-07-13 | self | Created a git worktree for feature work but ran all edits against the main checkout path (`~/code/seaquel/...`); the worktree stayed clean and the main tree collected the diff | When working in a worktree, every tool path must point INTO the worktree dir (`~/code/seaquel/.worktrees/<name>/...`). Verify with `git status` in the worktree after the first edit. |
| 2026-07-13 | self | Used `page.fill` in Browser automation; the harness exposes filling through `tab.fill` | Use the documented `tab` helpers for browser interactions; `page` is raw Puppeteer. |
| 2026-07-13 | self | Trusted the filtered `cargo test` summary without checking that it ran zero tests | Read the raw test artifact when filters are involved; server-only tests require `--no-default-features --features server`. |
| 2026-07-13 | self | Used a non-default project ID in an isolated server connection fixture, making an otherwise-loaded connection invisible in the project-filtered UI | Use `DEFAULT_PROJECT_ID` (`default-seaquel`) for fixture connections that should appear in the default project. |

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
- Schema cache: `src/lib/utils/schema-cache.ts` persists schema data (including columns) in localStorage keyed by `seaquel:schema-cache:v1:{type}:{host}:{port}:{databaseName}`. On `add`/`reconnect`, if a cache hit exists it's shown immediately and a background `fetchAndStoreSchema` refreshes; if no cache, the fetch is synchronous (blocking). `refreshSchema` (manual refresh button, post-DDL) passes `force: true` through `onSchemaLoaded` → `loadTableMetadataInBackground` to reload column metadata even when cached. The sidebar (`schema-tab.svelte`) debounces search (150ms) and caps rendered schema groups at 200 to prevent DOM explosion with 10k+ schemas.
- Worktree setup for this repo: the paraglide `src/lib/paraglide/` dir is fully gitignored (auto-generated), so a fresh worktree fails `npm run check` with 94 "Cannot find module $lib/paraglide" errors until you symlink/copy it (and `node_modules`) from the main checkout.
- Multi-user auth (PR #23): `AuthConfig` owns a `UserStore` (Argon2id hashes, file-persisted to `$SEAQUEL_DATA_DIR/users.json`). Tokens carry `{exp, sid, user, role}`. Bootstraps an `admin` user from `SEAQUEL_ADMIN_PASSWORD` on first start. `from_env()` is async. User management API at `/api/users` (admin-only via `AdminClaims` extractor). Frontend stores username + role in localStorage; `roleStore` (Svelte 5 runes) in `src/lib/auth/role.svelte.ts` provides reactive role checks.
- RBAC (PR #24): `Role` enum (Viewer < Editor < Admin) in `auth.rs` with `Ord` derive. `EditorClaims` / `AdminClaims` axum extractors in `server.rs` return 403 on insufficient role. Viewer = query/stream only; Editor = + execute/transaction/git write; Admin = + connections/secrets/SSH/users. `roleStore` in frontend gates UI; user management dialog in `src/lib/components/user-management-dialog.svelte`.
- Stale session bug: pre-RBAC logins store `seaquel_auth_token` in localStorage but NOT `seaquel_auth_role` (added in PR #23). `roleStore.init()` finds no role → defaults to `"viewer"` → admin UI (Users menu) hidden. Fix: `getAuthRole()`/`getAuthUser()` in `src/lib/auth/token.ts` now decode the role/user from the token payload (base64url JSON `{exp,sid,user,role}.sig`) as a fallback. The token always carries the role even when localStorage doesn't. Users with truly pre-RBAC tokens (no role field) must sign out and sign back in.
