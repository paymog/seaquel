import type { SqliteDatabase } from "./sqlite-types";
import { createRepo, col, nullable, bool, optBool, json, safeJsonParse } from "./create-repo";
import type { ColumnDef } from "./create-repo";
import type {
  PersistedProject,
  PersistedProjectState,
  PersistedSavedQuery,
  PersistedQueryHistoryItem,
  PersistedSharedQueryRepo,
  PersistedAIChat,
  PersistedAIMessage,
  PersistedQueryVersion,
  PersistedDashboardVersion,
} from "$lib/types";
import type { PersistedConnection } from "$lib/hooks/database/types";
import type { SavedWorkflow } from "$lib/types/workflow";

// === Projects ===

const _projectRepo = createRepo<Omit<PersistedProject, "customLabels">>({
  table: "projects",
  id: "id",
  columns: {
    id: col("id"),
    name: col("name"),
    description: nullable("description"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
    gitRepoPath: nullable("git_repo_path"),
  },
});

export const projectsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedProject[]> {
    const rows = await _projectRepo.loadAll(db);
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
        ...row,
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
    const { customLabels, ...base } = project;
    await _projectRepo.save(db, base);

    // Replace labels
    await db.execute("DELETE FROM project_labels WHERE project_id = ?", [project.id]);
    for (const label of customLabels) {
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
    await _projectRepo.remove(db, projectId);
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

type ConnectionRow = Omit<PersistedConnection, "labelIds">;

const _connectionRepo = createRepo<ConnectionRow>({
  table: "connections",
  id: "id",
  columns: {
    id: col("id"),
    projectId: col("project_id"),
    name: col("name"),
    type: col("type"),
    host: col("host"),
    port: col("port"),
    databaseName: col("database_name"),
    username: col("username"),
    sslMode: nullable("ssl_mode"),
    connectionString: nullable("connection_string"),
    lastConnected: {
      dbColumn: "last_connected",
      toDb: (v) => (v instanceof Date ? v.toISOString() : (v ?? null)),
      fromDb: (v) => (v ? new Date(v as string) : undefined),
    } as ColumnDef,
    sshTunnel: {
      dbColumn: "ssh_tunnel",
      toDb: (v) => (v ? JSON.stringify(v) : null),
      fromDb: (v) => safeJsonParse(v as string | null, undefined),
    } as ColumnDef,
    savePassword: bool("save_password"),
    saveSshPassword: bool("save_ssh_password"),
    saveSshKeyPassphrase: bool("save_ssh_key_passphrase"),
    isLocalOnly: {
      dbColumn: "is_local_only",
      toDb: (v) => (v ? 1 : 0),
      fromDb: (v) => (v === 1 ? true : undefined),
    } as ColumnDef,
    sharedConnectionId: nullable("shared_connection_id"),
    aiShareSchema: optBool("ai_share_schema"),
    aiShareData: optBool("ai_share_data"),
    activeAIProviderId: nullable("active_ai_provider_id"),
    activeAIModel: nullable("active_ai_model"),
  },
});

export const connectionsRepo = {
  async loadAll(db: SqliteDatabase): Promise<PersistedConnection[]> {
    const rows = await _connectionRepo.loadAll(db);
    const connections: PersistedConnection[] = [];
    for (const row of rows) {
      const labelRows = await db.query<{ label_id: string }>(
        "SELECT label_id FROM connection_labels WHERE connection_id = ?",
        [row.id],
      );
      connections.push({
        ...row,
        labelIds: labelRows.map((l) => l.label_id),
      });
    }
    return connections;
  },

  async save(db: SqliteDatabase, conn: PersistedConnection): Promise<void> {
    const { labelIds, ...base } = conn;
    await _connectionRepo.save(db, base);

    // Replace labels
    await db.execute("DELETE FROM connection_labels WHERE connection_id = ?", [conn.id]);
    for (const labelId of labelIds) {
      await db.execute("INSERT INTO connection_labels (connection_id, label_id) VALUES (?, ?)", [
        conn.id,
        labelId,
      ]);
    }
  },

  async remove(db: SqliteDatabase, connectionId: string): Promise<void> {
    await _connectionRepo.remove(db, connectionId);
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
        queryId: t.saved_query_id ?? t.shared_query_id ?? undefined,
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
    const savedWorkflows: SavedWorkflow[] = workflowRows
      .map((r) => safeJsonParse<SavedWorkflow | null>(r.data, null))
      .filter((w): w is SavedWorkflow => w !== null);

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
        starredSharedQueryIds = safeJsonParse(starredRow[0].starred_shared_query_ids, []);
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
        starredSharedDashboardIds = safeJsonParse(
          starredDashRow[0].starred_shared_dashboard_ids,
          [],
        );
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
        paneLayout = safeJsonParse(paneRow[0].pane_layout, undefined);
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
      tabOrder: safeJsonParse(state.tab_order, []),
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
        `INSERT INTO tabs (id, project_id, tab_type, name, query, saved_query_id)
         VALUES (?, ?, 'query', ?, ?, ?)`,
        [tab.id, state.projectId, tab.name, tab.query, tab.queryId ?? null],
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

const _savedQueryRepo = createRepo<PersistedSavedQuery>({
  table: "saved_queries",
  id: "id",
  columns: {
    id: col("id"),
    projectId: col("project_id"),
    name: col("name"),
    query: col("query"),
    parameters: json("parameters", undefined),
    starred: bool("starred"),
    shared: bool("shared"),
    description: nullable("description"),
    databaseType: nullable("database_type"),
    tags: json("tags", undefined),
    folder: nullable("folder"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
  },
});

export const savedQueriesRepo = {
  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedSavedQuery[]> {
    return _savedQueryRepo.loadBy(db, "project_id = ?", [projectId]);
  },

  async saveAll(
    db: SqliteDatabase,
    projectId: string,
    queries: PersistedSavedQuery[],
  ): Promise<void> {
    // Use upsert instead of delete+reinsert to preserve CASCADE children (query_versions)
    const currentIds = queries.map((q) => q.id);
    if (currentIds.length > 0) {
      // Delete only queries that were removed
      const placeholders = currentIds.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM saved_queries WHERE project_id = ? AND id NOT IN (${placeholders})`,
        [projectId, ...currentIds],
      );
    } else {
      await db.execute("DELETE FROM saved_queries WHERE project_id = ?", [projectId]);
    }
    for (const q of queries) {
      await db.execute(_savedQueryRepo.upsertSql, _savedQueryRepo.toParams(q));
    }
  },

  async removeByProject(db: SqliteDatabase, projectId: string): Promise<void> {
    return _savedQueryRepo.removeBy(db, "project_id = ?", [projectId]);
  },
};

// === Query Versions ===

const _queryVersionRepo = createRepo<PersistedQueryVersion>({
  table: "query_versions",
  id: "id",
  columns: {
    id: col("id"),
    queryId: col("saved_query_id"),
    version: col("version"),
    snapshot: col("snapshot"),
    diff: col("diff"),
    createdAt: col("created_at"),
  },
});

export const queryVersionsRepo = {
  async loadByQuery(db: SqliteDatabase, queryId: string): Promise<PersistedQueryVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM query_versions WHERE saved_query_id = ? ORDER BY version ASC",
      [queryId],
    );
    return rows.map((r) => _queryVersionRepo.mapRow(r));
  },

  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedQueryVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT qv.* FROM query_versions qv
       JOIN saved_queries sq ON sq.id = qv.saved_query_id
       WHERE sq.project_id = ?
       ORDER BY qv.saved_query_id, qv.version ASC`,
      [projectId],
    );
    return rows.map((r) => _queryVersionRepo.mapRow(r));
  },

  async insert(db: SqliteDatabase, version: PersistedQueryVersion): Promise<void> {
    await db.execute(_queryVersionRepo.insertSql, _queryVersionRepo.toParams(version));
  },

  async pruneOldVersions(db: SqliteDatabase, queryId: string, keepCount: number): Promise<void> {
    // Resolve all versions BEFORE pruning so we can promote the oldest survivor to a keyframe
    const allVersions = await this.loadByQuery(db, queryId);
    if (allVersions.length <= keepCount) return;

    // Find the version threshold — versions at or below this will be deleted
    const sorted = [...allVersions].sort((a, b) => b.version - a.version);
    const cutoffVersion = sorted[keepCount - 1]?.version;
    if (cutoffVersion === undefined) return;

    // Resolve texts before deleting, so we can recover the oldest survivor's full text
    const { resolveVersions } = await import("$lib/utils/query-versions");
    const resolved = resolveVersions(
      allVersions.map((v) => ({ ...v, createdAt: new Date(v.createdAt) })),
    );

    // Find the oldest survivor and its resolved text
    const oldestSurvivor = sorted[keepCount - 1];
    const resolvedSurvivor = resolved.find((r) => r.id === oldestSurvivor.id);

    await db.execute(
      `DELETE FROM query_versions
       WHERE saved_query_id = ?
         AND version < ?`,
      [queryId, cutoffVersion],
    );

    // Promote the oldest surviving version to a keyframe if it's a delta
    if (oldestSurvivor.snapshot === null && resolvedSurvivor) {
      await db.execute(`UPDATE query_versions SET snapshot = ?, diff = NULL WHERE id = ?`, [
        resolvedSurvivor.query,
        oldestSurvivor.id,
      ]);
    }
  },
};

// === Query History ===

const _historyRepo = createRepo<PersistedQueryHistoryItem>({
  table: "query_history",
  id: "id",
  columns: {
    id: col("id"),
    query: col("query"),
    timestamp: col("timestamp"),
    executionTime: col("execution_time"),
    rowCount: col("row_count"),
    connectionId: col("connection_id"),
    favorite: bool("favorite"),
    connectionLabelsSnapshot: json("connection_labels_snapshot", []),
    connectionNameSnapshot: col("connection_name_snapshot"),
  },
});

export const queryHistoryRepo = {
  async loadByConnection(
    db: SqliteDatabase,
    connectionId: string,
  ): Promise<PersistedQueryHistoryItem[]> {
    const rows = await db.query(
      `SELECT * FROM query_history WHERE connection_id = ? ORDER BY timestamp DESC`,
      [connectionId],
    );
    return rows.map((r) => _historyRepo.mapRow(r as Record<string, unknown>));
  },

  async replaceAll(
    db: SqliteDatabase,
    connectionId: string,
    items: PersistedQueryHistoryItem[],
  ): Promise<void> {
    await db.execute("DELETE FROM query_history WHERE connection_id = ?", [connectionId]);
    for (const h of items) {
      await db.execute(_historyRepo.insertSql, _historyRepo.toParams(h));
    }
  },

  async removeByConnection(db: SqliteDatabase, connectionId: string): Promise<void> {
    await _historyRepo.removeBy(db, "connection_id = ?", [connectionId]);
  },
};

// === Shared Repos ===

export const sharedReposRepo = {
  async loadAll(db: SqliteDatabase): Promise<{
    repos: PersistedSharedQueryRepo[];
    activeRepoId: string | null;
  }> {
    const rows = await db.query<{ id: string; data: string }>("SELECT id, data FROM shared_repos");
    const repos: PersistedSharedQueryRepo[] = rows
      .map((r) => safeJsonParse<PersistedSharedQueryRepo | null>(r.data, null))
      .filter((r): r is PersistedSharedQueryRepo => r !== null);
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
    return rows
      .map((r) => safeJsonParse<unknown>(r.data, null))
      .filter((t): t is NonNullable<typeof t> => t !== null);
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
    return safeJsonParse(rows[0].data, null);
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
    return safeJsonParse(rows[0].data, null);
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
  shared?: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/** Passes through on read; coerces `undefined` to `null` on write. */
function nullablePassthrough(dbColumn: string): ColumnDef {
  return {
    dbColumn,
    toDb: (v) => v ?? null,
    fromDb: (v) => v,
  };
}

const _dashboardsRepo = createRepo<PersistedDashboard>({
  table: "dashboards",
  id: "id",
  columns: {
    id: col("id"),
    projectId: col("project_id"),
    name: col("name"),
    viewport: col("viewport"),
    widgets: col("widgets"),
    dateFilter: nullablePassthrough("date_filter"),
    starred: bool("starred"),
    shared: bool("shared"),
    description: nullable("description"),
    createdAt: col("created_at"),
    updatedAt: col("updated_at"),
  },
});

export const dashboardsRepo = {
  loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedDashboard[]> {
    return _dashboardsRepo.loadBy(db, "project_id = ?", [projectId]);
  },
  save(db: SqliteDatabase, dashboard: PersistedDashboard): Promise<void> {
    return _dashboardsRepo.save(db, dashboard);
  },
  remove(db: SqliteDatabase, id: string): Promise<void> {
    return _dashboardsRepo.remove(db, id);
  },
  removeByProject(db: SqliteDatabase, projectId: string): Promise<void> {
    return _dashboardsRepo.removeBy(db, "project_id = ?", [projectId]);
  },
};

// === Dashboard Versions ===

const _dashboardVersionRepo = createRepo<PersistedDashboardVersion>({
  table: "dashboard_versions",
  id: "id",
  columns: {
    id: col("id"),
    dashboardId: col("dashboard_id"),
    version: col("version"),
    snapshot: col("snapshot"),
    createdAt: col("created_at"),
  },
});

export const dashboardVersionsRepo = {
  async loadByDashboard(
    db: SqliteDatabase,
    dashboardId: string,
  ): Promise<PersistedDashboardVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM dashboard_versions WHERE dashboard_id = ? ORDER BY version ASC",
      [dashboardId],
    );
    return rows.map((r) => _dashboardVersionRepo.mapRow(r));
  },

  async loadByProject(db: SqliteDatabase, projectId: string): Promise<PersistedDashboardVersion[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT dv.* FROM dashboard_versions dv
       JOIN dashboards d ON d.id = dv.dashboard_id
       WHERE d.project_id = ?
       ORDER BY dv.dashboard_id, dv.version ASC`,
      [projectId],
    );
    return rows.map((r) => _dashboardVersionRepo.mapRow(r));
  },

  async insert(db: SqliteDatabase, version: PersistedDashboardVersion): Promise<void> {
    await db.execute(_dashboardVersionRepo.insertSql, _dashboardVersionRepo.toParams(version));
  },

  async pruneOldVersions(
    db: SqliteDatabase,
    dashboardId: string,
    keepCount: number,
  ): Promise<void> {
    await db.execute(
      `DELETE FROM dashboard_versions
       WHERE dashboard_id = ?
         AND version <= (
           SELECT version FROM dashboard_versions
           WHERE dashboard_id = ?
           ORDER BY version DESC
           LIMIT 1 OFFSET ?
         )`,
      [dashboardId, dashboardId, keepCount],
    );
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

const _connectionOverridesRepo = createRepo<PersistedConnectionOverride>({
  table: "connection_overrides",
  id: "sharedConnectionId",
  columns: {
    sharedConnectionId: col("shared_connection_id"),
    username: nullable("username"),
    hostOverride: nullable("host_override"),
    portOverride: nullable("port_override"),
    savePassword: bool("save_password"),
    saveSshPassword: bool("save_ssh_password"),
    saveSshKeyPassphrase: bool("save_ssh_key_passphrase"),
  },
});

export const connectionOverridesRepo = {
  load(
    db: SqliteDatabase,
    sharedConnectionId: string,
  ): Promise<PersistedConnectionOverride | null> {
    return _connectionOverridesRepo.loadOneBy(db, "shared_connection_id = ?", [sharedConnectionId]);
  },
  loadAll(db: SqliteDatabase): Promise<PersistedConnectionOverride[]> {
    return _connectionOverridesRepo.loadAll(db);
  },
  save(db: SqliteDatabase, override: PersistedConnectionOverride): Promise<void> {
    return _connectionOverridesRepo.save(db, override);
  },
  remove(db: SqliteDatabase, sharedConnectionId: string): Promise<void> {
    return _connectionOverridesRepo.remove(db, sharedConnectionId);
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
    await _messageRepo.removeBy(db, "chat_id = ?", [chatId]);
    for (const m of messages) {
      await db.execute(_messageRepo.insertSql, _messageRepo.toParams(m));
    }
  },
};
