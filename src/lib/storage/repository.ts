import type { SqliteDatabase } from "./sqlite-types";
import type {
  PersistedProject,
  PersistedProjectState,
  PersistedSavedQuery,
  PersistedQueryHistoryItem,
  PersistedSharedQueryRepo,
  PersistedAIChat,
  PersistedAIMessage,
} from "$lib/types";
import type { PersistedConnection } from "$lib/hooks/database/types";
import type { SavedWorkflow } from "$lib/types/workflow";

// === Projects ===

export const projectsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedProject[]> {
    const rows = await db.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: string;
      updated_at: string;
      git_repo_path: string | null;
    }>("SELECT id, name, description, created_at, updated_at, git_repo_path FROM projects");

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
        gitRepoPath: row.git_repo_path ?? undefined,
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
      `INSERT INTO projects (id, name, description, created_at, updated_at, git_repo_path)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         updated_at = excluded.updated_at,
         git_repo_path = excluded.git_repo_path`,
      [
        project.id,
        project.name,
        project.description ?? null,
        project.createdAt,
        project.updatedAt,
        project.gitRepoPath ?? null,
      ],
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
      is_local_only: number;
      shared_connection_id: string | null;
      ai_share_schema: number | null;
      ai_share_data: number | null;
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
        isLocalOnly: row.is_local_only === 1 ? true : undefined,
        sharedConnectionId: row.shared_connection_id ?? undefined,
        aiShareSchema:
          row.ai_share_schema === null || row.ai_share_schema === undefined
            ? undefined
            : Boolean(row.ai_share_schema),
        aiShareData:
          row.ai_share_data === null || row.ai_share_data === undefined
            ? undefined
            : Boolean(row.ai_share_data),
      });
    }
    return connections;
  },

  async save(db: SqliteDatabase, conn: PersistedConnection): Promise<void> {
    await db.execute(
      `INSERT INTO connections
       (id, project_id, name, type, host, port, database_name, username, ssl_mode,
        connection_string, last_connected, ssh_tunnel, save_password, save_ssh_password,
        save_ssh_key_passphrase, is_local_only, shared_connection_id, ai_share_schema, ai_share_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         name = excluded.name,
         type = excluded.type,
         host = excluded.host,
         port = excluded.port,
         database_name = excluded.database_name,
         username = excluded.username,
         ssl_mode = excluded.ssl_mode,
         connection_string = excluded.connection_string,
         last_connected = excluded.last_connected,
         ssh_tunnel = excluded.ssh_tunnel,
         save_password = excluded.save_password,
         save_ssh_password = excluded.save_ssh_password,
         save_ssh_key_passphrase = excluded.save_ssh_key_passphrase,
         is_local_only = excluded.is_local_only,
         shared_connection_id = excluded.shared_connection_id,
         ai_share_schema = excluded.ai_share_schema,
         ai_share_data = excluded.ai_share_data`,
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
        conn.isLocalOnly ? 1 : 0,
        conn.sharedConnectionId ?? null,
        conn.aiShareSchema === undefined ? null : conn.aiShareSchema ? 1 : 0,
        conn.aiShareData === undefined ? null : conn.aiShareData ? 1 : 0,
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
      active_workflow_tab_id: string | null;
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

    const workflowTabs = tabs
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

    // Load saved workflows
    const dashboardTabs = tabs
      .filter((t) => t.tab_type === "dashboard")
      .map((t) => ({
        id: t.id,
        name: t.name,
        dashboardId: t.source_query ?? "",
      }));

    const workflowRows = await db.query<{ id: string; data: string }>(
      "SELECT id, data FROM saved_canvases WHERE project_id = ?",
      [projectId],
    );
    const savedWorkflows: SavedWorkflow[] = workflowRows.map((r) => JSON.parse(r.data));

    // Read active_dashboard_tab_id if the column exists
    let activeDashboardTabId: string | null = null;
    try {
      const dashRow = await db.query<{ active_dashboard_tab_id: string | null }>(
        "SELECT active_dashboard_tab_id FROM project_state WHERE project_id = ?",
        [projectId],
      );
      if (dashRow.length > 0) {
        activeDashboardTabId = dashRow[0].active_dashboard_tab_id;
      }
    } catch {
      // Column doesn't exist yet (pre-migration)
    }

    // Read starred_shared_query_ids if the column exists
    let starredSharedQueryIds: string[] = [];
    try {
      const starredRow = await db.query<{ starred_shared_query_ids: string }>(
        "SELECT starred_shared_query_ids FROM project_state WHERE project_id = ?",
        [projectId],
      );
      if (starredRow.length > 0) {
        starredSharedQueryIds = JSON.parse(starredRow[0].starred_shared_query_ids);
      }
    } catch {
      // Column doesn't exist yet (pre-migration)
    }

    // Read starred_shared_dashboard_ids if the column exists
    let starredSharedDashboardIds: string[] = [];
    try {
      const starredDashRow = await db.query<{ starred_shared_dashboard_ids: string }>(
        "SELECT starred_shared_dashboard_ids FROM project_state WHERE project_id = ?",
        [projectId],
      );
      if (starredDashRow.length > 0) {
        starredSharedDashboardIds = JSON.parse(starredDashRow[0].starred_shared_dashboard_ids);
      }
    } catch {
      // Column doesn't exist yet (pre-migration)
    }

    // Read pane_layout if the column exists
    let paneLayout: PersistedProjectState["paneLayout"] | undefined;
    try {
      const paneRow = await db.query<{ pane_layout: string | null }>(
        "SELECT pane_layout FROM project_state WHERE project_id = ?",
        [projectId],
      );
      if (paneRow.length > 0 && paneRow[0].pane_layout) {
        paneLayout = JSON.parse(paneRow[0].pane_layout);
      }
    } catch {
      // Column doesn't exist yet (pre-v4 migration)
    }

    return {
      projectId,
      queryTabs,
      schemaTabs,
      explainTabs,
      erdTabs,
      statisticsTabs,
      workflowTabs,
      tabOrder: JSON.parse(state.tab_order),
      activeQueryTabId: state.active_query_tab_id,
      activeSchemaTabId: state.active_schema_tab_id,
      activeExplainTabId: state.active_explain_tab_id,
      activeErdTabId: state.active_erd_tab_id,
      activeStatisticsTabId: state.active_statistics_tab_id,
      activeWorkflowTabId: state.active_workflow_tab_id,
      activeView: state.active_view as PersistedProjectState["activeView"],
      activeConnectionId: state.active_connection_id,
      starterTabs,
      activeStarterTabId: state.active_starter_tab_id,
      savedWorkflows,
      dashboardTabs,
      activeDashboardTabId,
      starredSharedQueryIds,
      starredSharedDashboardIds,
      paneLayout,
    };
  },

  async save(db: SqliteDatabase, state: PersistedProjectState): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO project_state
       (project_id, active_view, active_connection_id, active_query_tab_id, active_schema_tab_id,
        active_explain_tab_id, active_erd_tab_id, active_statistics_tab_id, active_workflow_tab_id,
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
        state.activeWorkflowTabId ?? null,
        null, // activeVisualizeTabId
        state.activeStarterTabId ?? null,
        JSON.stringify(state.tabOrder),
      ],
    );

    // Save active dashboard tab ID (column added in v3 migration)
    try {
      await db.execute(
        `UPDATE project_state SET active_dashboard_tab_id = ? WHERE project_id = ?`,
        [state.activeDashboardTabId ?? null, state.projectId],
      );
    } catch {
      // Column may not exist yet (pre-v3 migration)
    }

    // Save starred shared query IDs
    try {
      await db.execute(
        `UPDATE project_state SET starred_shared_query_ids = ? WHERE project_id = ?`,
        [JSON.stringify(state.starredSharedQueryIds ?? []), state.projectId],
      );
    } catch {
      // Column may not exist yet (pre-migration)
    }

    // Save starred shared dashboard IDs
    try {
      await db.execute(
        `UPDATE project_state SET starred_shared_dashboard_ids = ? WHERE project_id = ?`,
        [JSON.stringify(state.starredSharedDashboardIds ?? []), state.projectId],
      );
    } catch {
      // Column may not exist yet (pre-migration)
    }

    // Save pane layout (column added by v4 migration)
    try {
      await db.execute(`UPDATE project_state SET pane_layout = ? WHERE project_id = ?`, [
        state.paneLayout ? JSON.stringify(state.paneLayout) : null,
        state.projectId,
      ]);
    } catch {
      // Column doesn't exist yet (pre-v4 migration)
    }

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

    for (const tab of state.workflowTabs ?? []) {
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

    for (const tab of state.dashboardTabs ?? []) {
      await db.execute(
        `INSERT INTO tabs (id, project_id, tab_type, name, source_query)
         VALUES (?, ?, 'dashboard', ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.dashboardId],
      );
    }

    // Replace saved workflows
    await db.execute("DELETE FROM saved_canvases WHERE project_id = ?", [state.projectId]);
    for (const workflow of state.savedWorkflows ?? []) {
      await db.execute("INSERT INTO saved_canvases (id, project_id, data) VALUES (?, ?, ?)", [
        (workflow as { id?: string }).id ?? `workflow-${crypto.randomUUID()}`,
        state.projectId,
        JSON.stringify(workflow),
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
  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedSavedQuery[]> {
    const rows = await db.query<{
      id: string;
      project_id: string;
      name: string;
      query: string;
      parameters: string | null;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM saved_queries WHERE project_id = ?", [projectId]);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      query: r.query,
      parameters: r.parameters ? JSON.parse(r.parameters) : undefined,
      starred: !!(r as Record<string, unknown>).starred,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async saveAll(
    db: SqliteDatabase,
    projectId: string,
    queries: PersistedSavedQuery[],
  ): Promise<void> {
    await db.execute("DELETE FROM saved_queries WHERE project_id = ?", [projectId]);
    for (const q of queries) {
      await db.execute(
        `INSERT INTO saved_queries (id, project_id, name, query, parameters, starred, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          q.id,
          projectId,
          q.name,
          q.query,
          q.parameters ? JSON.stringify(q.parameters) : null,
          q.starred ? 1 : 0,
          q.createdAt,
          q.updatedAt,
        ],
      );
    }
  },

  async removeByProject(db: SqliteDatabase, projectId: string): Promise<void> {
    await db.execute("DELETE FROM saved_queries WHERE project_id = ?", [projectId]);
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
  async load(db: SqliteDatabase): Promise<unknown> {
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
  async load(db: SqliteDatabase): Promise<unknown> {
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

// === Dashboards ===

export interface PersistedDashboard {
  id: string;
  projectId: string;
  name: string;
  viewport: string; // JSON: { x, y, zoom }
  widgets: string; // JSON blob
  dateFilter?: string | null;
  starred?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const dashboardsRepo = {
  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedDashboard[]> {
    const rows = await db.query<{
      id: string;
      project_id: string;
      name: string;
      viewport: string;
      widgets: string;
      date_filter: string | null;
      starred: number | null;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM dashboards WHERE project_id = ?", [projectId]);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      viewport: r.viewport,
      widgets: r.widgets,
      dateFilter: r.date_filter,
      starred: (r.starred ?? 0) === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async save(db: SqliteDatabase, dashboard: PersistedDashboard): Promise<void> {
    await db.execute(
      `INSERT INTO dashboards (id, project_id, name, viewport, widgets, date_filter, starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         viewport = excluded.viewport,
         widgets = excluded.widgets,
         date_filter = excluded.date_filter,
         starred = excluded.starred,
         updated_at = excluded.updated_at`,
      [
        dashboard.id,
        dashboard.projectId,
        dashboard.name,
        dashboard.viewport,
        dashboard.widgets,
        dashboard.dateFilter ?? null,
        dashboard.starred ? 1 : 0,
        dashboard.createdAt,
        dashboard.updatedAt,
      ],
    );
  },

  async remove(db: SqliteDatabase, id: string): Promise<void> {
    await db.execute("DELETE FROM dashboards WHERE id = ?", [id]);
  },

  async removeByProject(db: SqliteDatabase, projectId: string): Promise<void> {
    await db.execute("DELETE FROM dashboards WHERE project_id = ?", [projectId]);
  },
};

// === Connection Overrides ===

export interface PersistedConnectionOverride {
  sharedConnectionId: string;
  username?: string;
  hostOverride?: string;
  portOverride?: number;
  savePassword: boolean;
  saveSshPassword: boolean;
  saveSshKeyPassphrase: boolean;
}

export const connectionOverridesRepo = {
  async load(
    db: SqliteDatabase,
    sharedConnectionId: string,
  ): Promise<PersistedConnectionOverride | null> {
    const rows = await db.query<{
      shared_connection_id: string;
      username: string | null;
      host_override: string | null;
      port_override: number | null;
      save_password: number;
      save_ssh_password: number;
      save_ssh_key_passphrase: number;
    }>("SELECT * FROM connection_overrides WHERE shared_connection_id = ?", [sharedConnectionId]);

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      sharedConnectionId: r.shared_connection_id,
      username: r.username ?? undefined,
      hostOverride: r.host_override ?? undefined,
      portOverride: r.port_override ?? undefined,
      savePassword: r.save_password === 1,
      saveSshPassword: r.save_ssh_password === 1,
      saveSshKeyPassphrase: r.save_ssh_key_passphrase === 1,
    };
  },

  async loadAll(db: SqliteDatabase): Promise<PersistedConnectionOverride[]> {
    const rows = await db.query<{
      shared_connection_id: string;
      username: string | null;
      host_override: string | null;
      port_override: number | null;
      save_password: number;
      save_ssh_password: number;
      save_ssh_key_passphrase: number;
    }>("SELECT * FROM connection_overrides");

    return rows.map((r) => ({
      sharedConnectionId: r.shared_connection_id,
      username: r.username ?? undefined,
      hostOverride: r.host_override ?? undefined,
      portOverride: r.port_override ?? undefined,
      savePassword: r.save_password === 1,
      saveSshPassword: r.save_ssh_password === 1,
      saveSshKeyPassphrase: r.save_ssh_key_passphrase === 1,
    }));
  },

  async save(db: SqliteDatabase, override: PersistedConnectionOverride): Promise<void> {
    await db.execute(
      `INSERT INTO connection_overrides
       (shared_connection_id, username, host_override, port_override,
        save_password, save_ssh_password, save_ssh_key_passphrase)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shared_connection_id) DO UPDATE SET
         username = excluded.username,
         host_override = excluded.host_override,
         port_override = excluded.port_override,
         save_password = excluded.save_password,
         save_ssh_password = excluded.save_ssh_password,
         save_ssh_key_passphrase = excluded.save_ssh_key_passphrase`,
      [
        override.sharedConnectionId,
        override.username ?? null,
        override.hostOverride ?? null,
        override.portOverride ?? null,
        override.savePassword ? 1 : 0,
        override.saveSshPassword ? 1 : 0,
        override.saveSshKeyPassphrase ? 1 : 0,
      ],
    );
  },

  async remove(db: SqliteDatabase, sharedConnectionId: string): Promise<void> {
    await db.execute("DELETE FROM connection_overrides WHERE shared_connection_id = ?", [
      sharedConnectionId,
    ]);
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

// === AI Chats ===

export const aiChatsRepo = {
  async loadByConnection(db: SqliteDatabase, connectionId: string): Promise<PersistedAIChat[]> {
    const rows = await db.query<{
      id: string;
      connection_id: string;
      title: string;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM ai_chats WHERE connection_id = ? ORDER BY updated_at DESC", [connectionId]);
    return rows.map((r) => ({
      id: r.id,
      connectionId: r.connection_id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async saveChat(db: SqliteDatabase, chat: PersistedAIChat): Promise<void> {
    await db.execute(
      `INSERT INTO ai_chats (id, connection_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at`,
      [chat.id, chat.connectionId, chat.title, chat.createdAt, chat.updatedAt],
    );
  },

  async removeChat(db: SqliteDatabase, chatId: string): Promise<void> {
    await db.execute("DELETE FROM ai_chats WHERE id = ?", [chatId]);
  },

  async removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    await db.execute("DELETE FROM ai_chats WHERE connection_id = ?", [connectionId]);
  },

  async loadMessages(db: SqliteDatabase, chatId: string): Promise<PersistedAIMessage[]> {
    const rows = await db.query<{
      id: string;
      chat_id: string;
      role: string;
      content: string;
      timestamp: string;
      query: string | null;
    }>("SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY timestamp ASC", [chatId]);
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      timestamp: r.timestamp,
      query: r.query ?? undefined,
    }));
  },

  async replaceAllMessages(
    db: SqliteDatabase,
    chatId: string,
    messages: PersistedAIMessage[],
  ): Promise<void> {
    await db.execute("DELETE FROM ai_messages WHERE chat_id = ?", [chatId]);
    for (const m of messages) {
      await db.execute(
        `INSERT INTO ai_messages (id, chat_id, role, content, timestamp, query)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [m.id, chatId, m.role, m.content, m.timestamp, m.query ?? null],
      );
    }
  },
};
