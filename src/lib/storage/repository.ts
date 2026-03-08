import type { SqliteDatabase } from "./sqlite-types";
import type {
  PersistedProject,
  PersistedProjectState,
  PersistedSavedQuery,
  PersistedQueryHistoryItem,
  PersistedSharedQueryRepo,
} from "$lib/types";
import type { ConnectionLabel } from "$lib/types/project";
import type { PersistedConnection } from "$lib/hooks/database/types";
import type { SavedCanvas } from "$lib/types/canvas";

// === Projects ===

export const projectsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedProject[]> {
    const rows = await db.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: string;
      updated_at: string;
    }>("SELECT id, name, description, created_at, updated_at FROM projects");

    const projects: PersistedProject[] = [];
    for (const row of rows) {
      const labels = await db.query<{
        id: string;
        name: string;
        is_predefined: number;
        color: string;
      }>("SELECT id, name, is_predefined, color FROM project_labels WHERE project_id = ?", [
        row.id,
      ]);

      projects.push({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        customLabels: labels.map((l) => ({
          id: l.id,
          name: l.name,
          isPredefined: l.is_predefined === 1,
          color: l.color,
        })),
      });
    }
    return projects;
  },

  async save(db: SqliteDatabase, project: PersistedProject): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [project.id, project.name, project.description ?? null, project.createdAt, project.updatedAt],
    );

    // Replace labels
    await db.execute("DELETE FROM project_labels WHERE project_id = ?", [project.id]);
    for (const label of project.customLabels) {
      await db.execute(
        `INSERT INTO project_labels (id, project_id, name, is_predefined, color)
         VALUES (?, ?, ?, ?, ?)`,
        [label.id, project.id, label.name, label.isPredefined ? 1 : 0, label.color],
      );
    }
  },

  async saveAll(db: SqliteDatabase, projects: PersistedProject[]): Promise<void> {
    for (const project of projects) {
      await this.save(db, project);
    }
  },

  async remove(db: SqliteDatabase, projectId: string): Promise<void> {
    await db.execute("DELETE FROM projects WHERE id = ?", [projectId]);
  },
};

// === App State ===

export const appStateRepo = {
  async get(db: SqliteDatabase, key: string): Promise<string | null> {
    const rows = await db.query<{ value: string | null }>(
      "SELECT value FROM app_state WHERE key = ?",
      [key],
    );
    if (rows.length === 0) return null;
    return rows[0].value;
  },

  async set(db: SqliteDatabase, key: string, value: string | null): Promise<void> {
    await db.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [key, value]);
  },
};

// === Connections ===

export const connectionsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedConnection[]> {
    const rows = await db.query<{
      id: string;
      project_id: string;
      name: string;
      type: string;
      host: string;
      port: number;
      database_name: string;
      username: string;
      ssl_mode: string | null;
      connection_string: string | null;
      last_connected: string | null;
      ssh_tunnel: string | null;
      save_password: number;
      save_ssh_password: number;
      save_ssh_key_passphrase: number;
    }>("SELECT * FROM connections");

    const connections: PersistedConnection[] = [];
    for (const row of rows) {
      const labelRows = await db.query<{ label_id: string }>(
        "SELECT label_id FROM connection_labels WHERE connection_id = ?",
        [row.id],
      );

      connections.push({
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        type: row.type as PersistedConnection["type"],
        host: row.host,
        port: row.port,
        databaseName: row.database_name,
        username: row.username,
        sslMode: row.ssl_mode ?? undefined,
        connectionString: row.connection_string ?? undefined,
        lastConnected: row.last_connected ? new Date(row.last_connected) : undefined,
        sshTunnel: row.ssh_tunnel ? JSON.parse(row.ssh_tunnel) : undefined,
        savePassword: row.save_password === 1,
        saveSshPassword: row.save_ssh_password === 1,
        saveSshKeyPassphrase: row.save_ssh_key_passphrase === 1,
        labelIds: labelRows.map((l) => l.label_id),
      });
    }
    return connections;
  },

  async save(db: SqliteDatabase, conn: PersistedConnection): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO connections
       (id, project_id, name, type, host, port, database_name, username, ssl_mode,
        connection_string, last_connected, ssh_tunnel, save_password, save_ssh_password,
        save_ssh_key_passphrase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conn.id,
        conn.projectId,
        conn.name,
        conn.type,
        conn.host,
        conn.port,
        conn.databaseName,
        conn.username,
        conn.sslMode ?? null,
        conn.connectionString ?? null,
        conn.lastConnected instanceof Date
          ? conn.lastConnected.toISOString()
          : (conn.lastConnected ?? null),
        conn.sshTunnel ? JSON.stringify(conn.sshTunnel) : null,
        conn.savePassword ? 1 : 0,
        conn.saveSshPassword ? 1 : 0,
        conn.saveSshKeyPassphrase ? 1 : 0,
      ],
    );

    // Replace labels
    await db.execute("DELETE FROM connection_labels WHERE connection_id = ?", [conn.id]);
    for (const labelId of conn.labelIds) {
      await db.execute("INSERT INTO connection_labels (connection_id, label_id) VALUES (?, ?)", [
        conn.id,
        labelId,
      ]);
    }
  },

  async remove(db: SqliteDatabase, connectionId: string): Promise<void> {
    await db.execute("DELETE FROM connections WHERE id = ?", [connectionId]);
  },
};

// === Project State ===

export const projectStateRepo = {
  async load(db: SqliteDatabase, projectId: string): Promise<PersistedProjectState | null> {
    const rows = await db.query<{
      active_view: string;
      active_connection_id: string | null;
      active_query_tab_id: string | null;
      active_schema_tab_id: string | null;
      active_explain_tab_id: string | null;
      active_erd_tab_id: string | null;
      active_statistics_tab_id: string | null;
      active_canvas_tab_id: string | null;
      active_visualize_tab_id: string | null;
      active_starter_tab_id: string | null;
      tab_order: string;
    }>("SELECT * FROM project_state WHERE project_id = ?", [projectId]);

    if (rows.length === 0) return null;
    const state = rows[0];

    // Load tabs
    const tabs = await db.query<{
      id: string;
      tab_type: string;
      name: string;
      query: string | null;
      saved_query_id: string | null;
      shared_query_id: string | null;
      table_name: string | null;
      schema_name: string | null;
      source_query: string | null;
      connection_id: string | null;
      starter_type: string | null;
      closable: number | null;
    }>("SELECT * FROM tabs WHERE project_id = ?", [projectId]);

    const queryTabs = tabs
      .filter((t) => t.tab_type === "query")
      .map((t) => ({
        id: t.id,
        name: t.name,
        query: t.query ?? "",
        savedQueryId: t.saved_query_id ?? undefined,
        sharedQueryId: t.shared_query_id ?? undefined,
      }));

    const schemaTabs = tabs
      .filter((t) => t.tab_type === "schema")
      .map((t) => ({
        id: t.id,
        tableName: t.table_name ?? "",
        schemaName: t.schema_name ?? "",
      }));

    const explainTabs = tabs
      .filter((t) => t.tab_type === "explain")
      .map((t) => ({
        id: t.id,
        name: t.name,
        sourceQuery: t.source_query ?? "",
      }));

    const erdTabs = tabs
      .filter((t) => t.tab_type === "erd")
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connection_id ?? undefined,
      }));

    const statisticsTabs = tabs
      .filter((t) => t.tab_type === "statistics")
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connection_id ?? "",
      }));

    const canvasTabs = tabs
      .filter((t) => t.tab_type === "canvas")
      .map((t) => ({
        id: t.id,
        name: t.name,
        connectionId: t.connection_id ?? "",
      }));

    const starterTabs = tabs
      .filter((t) => t.tab_type === "starter")
      .map((t) => ({
        id: t.id,
        type: (t.starter_type ?? "getting-started") as "getting-started" | "migration-tips",
        name: t.name,
        closable: t.closable === 1,
      }));

    // Load saved canvases
    const canvasRows = await db.query<{ id: string; data: string }>(
      "SELECT id, data FROM saved_canvases WHERE project_id = ?",
      [projectId],
    );
    const savedCanvases: SavedCanvas[] = canvasRows.map((r) => JSON.parse(r.data));

    return {
      projectId,
      queryTabs,
      schemaTabs,
      explainTabs,
      erdTabs,
      statisticsTabs,
      canvasTabs,
      tabOrder: JSON.parse(state.tab_order),
      activeQueryTabId: state.active_query_tab_id,
      activeSchemaTabId: state.active_schema_tab_id,
      activeExplainTabId: state.active_explain_tab_id,
      activeErdTabId: state.active_erd_tab_id,
      activeStatisticsTabId: state.active_statistics_tab_id,
      activeCanvasTabId: state.active_canvas_tab_id,
      activeView: state.active_view as PersistedProjectState["activeView"],
      activeConnectionId: state.active_connection_id,
      starterTabs,
      activeStarterTabId: state.active_starter_tab_id,
      savedCanvases,
    };
  },

  async save(db: SqliteDatabase, state: PersistedProjectState): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO project_state
       (project_id, active_view, active_connection_id, active_query_tab_id, active_schema_tab_id,
        active_explain_tab_id, active_erd_tab_id, active_statistics_tab_id, active_canvas_tab_id,
        active_visualize_tab_id, active_starter_tab_id, tab_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.projectId,
        state.activeView,
        state.activeConnectionId,
        state.activeQueryTabId,
        state.activeSchemaTabId,
        state.activeExplainTabId,
        state.activeErdTabId,
        state.activeStatisticsTabId ?? null,
        state.activeCanvasTabId ?? null,
        null, // activeVisualizeTabId
        state.activeStarterTabId ?? null,
        JSON.stringify(state.tabOrder),
      ],
    );

    // Replace all tabs for this project
    await db.execute("DELETE FROM tabs WHERE project_id = ?", [state.projectId]);

    for (const tab of state.queryTabs) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, query, saved_query_id, shared_query_id)
         VALUES (?, ?, 'query', ?, ?, ?, ?)`,
        [
          tab.id,
          state.projectId,
          tab.name,
          tab.query,
          tab.savedQueryId ?? null,
          tab.sharedQueryId ?? null,
        ],
      );
    }

    for (const tab of state.schemaTabs) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, table_name, schema_name)
         VALUES (?, ?, 'schema', ?, ?, ?)`,
        [tab.id, state.projectId, tab.tableName, tab.tableName, tab.schemaName],
      );
    }

    for (const tab of state.explainTabs) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, source_query)
         VALUES (?, ?, 'explain', ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.sourceQuery],
      );
    }

    for (const tab of state.erdTabs) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, connection_id)
         VALUES (?, ?, 'erd', ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.connectionId ?? null],
      );
    }

    for (const tab of state.statisticsTabs ?? []) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, connection_id)
         VALUES (?, ?, 'statistics', ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.connectionId],
      );
    }

    for (const tab of state.canvasTabs ?? []) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, connection_id)
         VALUES (?, ?, 'canvas', ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.connectionId],
      );
    }

    for (const tab of state.starterTabs ?? []) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, starter_type, closable)
         VALUES (?, ?, 'starter', ?, ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.type, tab.closable ? 1 : 0],
      );
    }

    // Replace saved canvases
    await db.execute("DELETE FROM saved_canvases WHERE project_id = ?", [state.projectId]);
    for (const canvas of state.savedCanvases ?? []) {
      await db.execute("INSERT INTO saved_canvases (id, project_id, data) VALUES (?, ?, ?)", [
        (canvas as { id?: string }).id ?? crypto.randomUUID(),
        state.projectId,
        JSON.stringify(canvas),
      ]);
    }
  },

  async remove(db: SqliteDatabase, projectId: string): Promise<void> {
    await db.execute("DELETE FROM project_state WHERE project_id = ?", [projectId]);
    await db.execute("DELETE FROM tabs WHERE project_id = ?", [projectId]);
    await db.execute("DELETE FROM saved_canvases WHERE project_id = ?", [projectId]);
  },
};

// === Saved Queries ===

export const savedQueriesRepo = {
  async loadByConnection(db: SqliteDatabase, connectionId: string): Promise<PersistedSavedQuery[]> {
    const rows = await db.query<{
      id: string;
      connection_id: string;
      name: string;
      query: string;
      parameters: string | null;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM saved_queries WHERE connection_id = ?", [connectionId]);

    return rows.map((r) => ({
      id: r.id,
      connectionId: r.connection_id,
      name: r.name,
      query: r.query,
      parameters: r.parameters ? JSON.parse(r.parameters) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async saveAll(
    db: SqliteDatabase,
    connectionId: string,
    queries: PersistedSavedQuery[],
  ): Promise<void> {
    await db.execute("DELETE FROM saved_queries WHERE connection_id = ?", [connectionId]);
    for (const q of queries) {
      await db.execute(
        `INSERT INTO saved_queries (id, connection_id, name, query, parameters, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          q.id,
          connectionId,
          q.name,
          q.query,
          q.parameters ? JSON.stringify(q.parameters) : null,
          q.createdAt,
          q.updatedAt,
        ],
      );
    }
  },

  async removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    await db.execute("DELETE FROM saved_queries WHERE connection_id = ?", [connectionId]);
  },
};

// === Query History ===

export const queryHistoryRepo = {
  async loadByConnection(
    db: SqliteDatabase,
    connectionId: string,
  ): Promise<PersistedQueryHistoryItem[]> {
    const rows = await db.query<{
      id: string;
      connection_id: string;
      query: string;
      timestamp: string;
      execution_time: number;
      row_count: number;
      favorite: number;
      connection_labels_snapshot: string | null;
      connection_name_snapshot: string;
    }>("SELECT * FROM query_history WHERE connection_id = ? ORDER BY timestamp DESC", [
      connectionId,
    ]);

    return rows.map((r) => ({
      id: r.id,
      connectionId: r.connection_id,
      query: r.query,
      timestamp: r.timestamp,
      executionTime: r.execution_time,
      rowCount: r.row_count,
      favorite: r.favorite === 1,
      connectionLabelsSnapshot: r.connection_labels_snapshot
        ? JSON.parse(r.connection_labels_snapshot)
        : [],
      connectionNameSnapshot: r.connection_name_snapshot,
    }));
  },

  async replaceAll(
    db: SqliteDatabase,
    connectionId: string,
    items: PersistedQueryHistoryItem[],
  ): Promise<void> {
    await db.execute("DELETE FROM query_history WHERE connection_id = ?", [connectionId]);
    for (const h of items) {
      await db.execute(
        `INSERT INTO query_history
         (id, connection_id, query, timestamp, execution_time, row_count, favorite,
          connection_labels_snapshot, connection_name_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.id,
          connectionId,
          h.query,
          h.timestamp,
          h.executionTime,
          h.rowCount,
          h.favorite ? 1 : 0,
          h.connectionLabelsSnapshot ? JSON.stringify(h.connectionLabelsSnapshot) : null,
          h.connectionNameSnapshot,
        ],
      );
    }
  },

  async removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    await db.execute("DELETE FROM query_history WHERE connection_id = ?", [connectionId]);
  },
};

// === Shared Repos ===

export const sharedReposRepo = {
  async loadAll(db: SqliteDatabase): Promise<{
    repos: PersistedSharedQueryRepo[];
    activeRepoId: string | null;
  }> {
    const rows = await db.query<{ id: string; data: string }>("SELECT id, data FROM shared_repos");
    const repos: PersistedSharedQueryRepo[] = rows.map((r) => JSON.parse(r.data));
    const activeRepoId = await appStateRepo.get(db, "activeRepoId");
    return { repos, activeRepoId };
  },

  async saveAll(
    db: SqliteDatabase,
    repos: PersistedSharedQueryRepo[],
    activeRepoId: string | null,
  ): Promise<void> {
    await db.execute("DELETE FROM shared_repos");
    for (const repo of repos) {
      await db.execute("INSERT INTO shared_repos (id, data) VALUES (?, ?)", [
        repo.id,
        JSON.stringify(repo),
      ]);
    }
    await appStateRepo.set(db, "activeRepoId", activeRepoId);
  },
};

// === Themes ===

export const themeRepo = {
  async loadPreferences(
    db: SqliteDatabase,
  ): Promise<{ lightThemeId: string; darkThemeId: string } | null> {
    const rows = await db.query<{ light_theme_id: string; dark_theme_id: string }>(
      "SELECT light_theme_id, dark_theme_id FROM theme_preferences WHERE id = 1",
    );
    if (rows.length === 0) return null;
    return { lightThemeId: rows[0].light_theme_id, darkThemeId: rows[0].dark_theme_id };
  },

  async savePreferences(
    db: SqliteDatabase,
    lightThemeId: string,
    darkThemeId: string,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO theme_preferences (id, light_theme_id, dark_theme_id)
       VALUES (1, ?, ?)`,
      [lightThemeId, darkThemeId],
    );
  },

  async loadUserThemes(db: SqliteDatabase): Promise<unknown[]> {
    const rows = await db.query<{ id: string; data: string }>("SELECT id, data FROM user_themes");
    return rows.map((r) => JSON.parse(r.data));
  },

  async saveUserThemes(db: SqliteDatabase, themes: unknown[]): Promise<void> {
    await db.execute("DELETE FROM user_themes");
    for (const theme of themes) {
      const t = theme as { id: string };
      await db.execute("INSERT INTO user_themes (id, data) VALUES (?, ?)", [
        t.id,
        JSON.stringify(theme),
      ]);
    }
  },
};

// === License ===

export const licenseRepo = {
  async load(db: SqliteDatabase): Promise<unknown | null> {
    const rows = await db.query<{ data: string }>("SELECT data FROM license_state WHERE id = 1");
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].data);
  },

  async save(db: SqliteDatabase, data: unknown): Promise<void> {
    await db.execute("INSERT OR REPLACE INTO license_state (id, data) VALUES (1, ?)", [
      JSON.stringify(data),
    ]);
  },
};

// === Onboarding ===

export const onboardingRepo = {
  async load(db: SqliteDatabase): Promise<unknown | null> {
    const rows = await db.query<{ data: string }>("SELECT data FROM onboarding_state WHERE id = 1");
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].data);
  },

  async save(db: SqliteDatabase, data: unknown): Promise<void> {
    await db.execute("INSERT OR REPLACE INTO onboarding_state (id, data) VALUES (1, ?)", [
      JSON.stringify(data),
    ]);
  },
};

// === Tutorial Progress ===

export const tutorialRepo = {
  async loadAll(
    db: SqliteDatabase,
  ): Promise<Array<{ lessonId: string; challengeId: string; state: string | null }>> {
    return db.query<{ lessonId: string; challengeId: string; state: string | null }>(
      "SELECT lesson_id as lessonId, challenge_id as challengeId, state FROM tutorial_progress",
    );
  },

  async save(
    db: SqliteDatabase,
    lessonId: string,
    challengeId: string,
    state: string | null,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO tutorial_progress (lesson_id, challenge_id, state)
       VALUES (?, ?, ?)`,
      [lessonId, challengeId, state],
    );
  },

  async removeLesson(db: SqliteDatabase, lessonId: string): Promise<void> {
    await db.execute("DELETE FROM tutorial_progress WHERE lesson_id = ?", [lessonId]);
  },

  async removeAll(db: SqliteDatabase): Promise<void> {
    await db.execute("DELETE FROM tutorial_progress");
  },
};

// === Import State ===

export const importStateRepo = {
  async load(
    db: SqliteDatabase,
    source: string,
  ): Promise<{ hasOfferedImport: boolean; lastCheckTimestamp: string | null } | null> {
    const rows = await db.query<{
      has_offered_import: number;
      last_check_timestamp: string | null;
    }>("SELECT has_offered_import, last_check_timestamp FROM import_state WHERE source = ?", [
      source,
    ]);
    if (rows.length === 0) return null;
    return {
      hasOfferedImport: rows[0].has_offered_import === 1,
      lastCheckTimestamp: rows[0].last_check_timestamp,
    };
  },

  async save(
    db: SqliteDatabase,
    source: string,
    hasOfferedImport: boolean,
    lastCheckTimestamp: string | null,
  ): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO import_state (source, has_offered_import, last_check_timestamp)
       VALUES (?, ?, ?)`,
      [source, hasOfferedImport ? 1 : 0, lastCheckTimestamp],
    );
  },
};
