import type { SqliteDatabase } from "./sqlite-types";

const SCHEMA_VERSION = 1;

const DDL_STATEMENTS = [
  // Version tracking
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Projects
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS project_labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_predefined INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL
  )`,

  // App state (key-value for simple settings)
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,

  // Connections
  `CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    database_name TEXT NOT NULL,
    username TEXT NOT NULL,
    ssl_mode TEXT,
    connection_string TEXT,
    last_connected TEXT,
    ssh_tunnel TEXT,
    save_password INTEGER NOT NULL DEFAULT 0,
    save_ssh_password INTEGER NOT NULL DEFAULT 0,
    save_ssh_key_passphrase INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_connections_project ON connections(project_id)`,

  `CREATE TABLE IF NOT EXISTS connection_labels (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL,
    PRIMARY KEY (connection_id, label_id)
  )`,

  // Project UI state
  `CREATE TABLE IF NOT EXISTS project_state (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    active_view TEXT NOT NULL DEFAULT 'query',
    active_connection_id TEXT,
    active_query_tab_id TEXT,
    active_schema_tab_id TEXT,
    active_explain_tab_id TEXT,
    active_erd_tab_id TEXT,
    active_statistics_tab_id TEXT,
    active_canvas_tab_id TEXT,
    active_visualize_tab_id TEXT,
    active_starter_tab_id TEXT,
    tab_order TEXT NOT NULL DEFAULT '[]'
  )`,

  // All tab types (discriminated by tab_type)
  `CREATE TABLE IF NOT EXISTS tabs (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tab_type TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT,
    saved_query_id TEXT,
    shared_query_id TEXT,
    table_name TEXT,
    schema_name TEXT,
    source_query TEXT,
    connection_id TEXT,
    starter_type TEXT,
    closable INTEGER,
    PRIMARY KEY (id, project_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tabs_project ON tabs(project_id)`,

  // Saved queries
  `CREATE TABLE IF NOT EXISTS saved_queries (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    parameters TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_saved_queries_connection ON saved_queries(connection_id)`,

  // Query history
  `CREATE TABLE IF NOT EXISTS query_history (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    execution_time REAL NOT NULL,
    row_count INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    connection_labels_snapshot TEXT,
    connection_name_snapshot TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_history_conn_time ON query_history(connection_id, timestamp DESC)`,

  // Shared repos
  `CREATE TABLE IF NOT EXISTS shared_repos (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,

  // Saved canvases
  `CREATE TABLE IF NOT EXISTS saved_canvases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  )`,

  // Theme preferences (singleton)
  `CREATE TABLE IF NOT EXISTS theme_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    light_theme_id TEXT NOT NULL DEFAULT 'default-light',
    dark_theme_id TEXT NOT NULL DEFAULT 'default-dark'
  )`,

  // User themes
  `CREATE TABLE IF NOT EXISTS user_themes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,

  // License state (singleton)
  `CREATE TABLE IF NOT EXISTS license_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL DEFAULT '{}'
  )`,

  // Onboarding state (singleton)
  `CREATE TABLE IF NOT EXISTS onboarding_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL DEFAULT '{}'
  )`,

  // Tutorial progress
  `CREATE TABLE IF NOT EXISTS tutorial_progress (
    lesson_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    state TEXT,
    PRIMARY KEY (lesson_id, challenge_id)
  )`,

  // Import state
  `CREATE TABLE IF NOT EXISTS import_state (
    source TEXT PRIMARY KEY,
    has_offered_import INTEGER NOT NULL DEFAULT 0,
    last_check_timestamp TEXT
  )`,
];

/**
 * Initialize the database schema. Returns true if this was a fresh database
 * (tables were just created), false if the schema already existed.
 */
export async function initializeSchema(db: SqliteDatabase): Promise<boolean> {
  // Check if schema already exists
  const existing = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
  );

  if (existing.length > 0) {
    // Schema already initialized
    return false;
  }

  // Create all tables (but don't insert schema_version yet —
  // the caller will do that after checking for JSON migration)
  const statements = DDL_STATEMENTS.map((sql) => ({ sql }));
  await db.transaction(statements);

  return true;
}

export { SCHEMA_VERSION };
