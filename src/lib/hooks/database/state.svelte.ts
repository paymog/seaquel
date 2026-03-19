import type {
  DatabaseConnection,
  SchemaTable,
  QueryTab,
  QueryHistoryItem,
  AIMessage,
  SchemaTab,
  SavedQuery,
  ExplainTab,
  ErdTab,
  StatisticsTab,
  CanvasTab,
  VisualizeTab,
  ConnectionTab,
  Project,
  StarterTab,
  SharedQueryRepo,
  SharedQuery,
  SyncState,
  DashboardTab,
  Dashboard,
  SharedProject,
  SharedConnection,
  ConnectionOverride,
} from "$lib/types";
import type { ConnectionLabel } from "$lib/types/project";
import type { SavedCanvas } from "$lib/types/canvas";

/**
 * Central state container for the database module.
 * All reactive state and derived values are declared here.
 * Modules receive this instance and read/write state through it.
 *
 * State is organized using Records (objects) instead of Maps for simpler
 * reactivity updates using spread syntax.
 *
 * Tabs are organized per-PROJECT (not per-connection) to allow:
 * - Switching between projects with separate tab sets
 * - Executing queries against different connections within the same project
 *
 * Query history and saved queries remain per-CONNECTION since they are
 * tied to the specific connection that executed them.
 */
export class DatabaseState {
  // === PROJECT STATE ===
  projects = $state<Project[]>([]);
  projectsLoading = $state(true);
  activeProjectId = $state<string | null>(null);

  // === CONNECTION STATE ===
  connections = $state<DatabaseConnection[]>([]);
  connectionsLoading = $state(true);
  schemas = $state<Record<string, SchemaTable[]>>({});

  // Active connection tracked per project
  activeConnectionIdByProject = $state<Record<string, string | null>>({});

  // === TABS STATE (per-project) ===
  queryTabsByProject = $state<Record<string, QueryTab[]>>({});
  activeQueryTabIdByProject = $state<Record<string, string | null>>({});

  schemaTabsByProject = $state<Record<string, SchemaTab[]>>({});
  activeSchemaTabIdByProject = $state<Record<string, string | null>>({});

  explainTabsByProject = $state<Record<string, ExplainTab[]>>({});
  activeExplainTabIdByProject = $state<Record<string, string | null>>({});

  erdTabsByProject = $state<Record<string, ErdTab[]>>({});
  activeErdTabIdByProject = $state<Record<string, string | null>>({});

  statisticsTabsByProject = $state<Record<string, StatisticsTab[]>>({});
  activeStatisticsTabIdByProject = $state<Record<string, string | null>>({});

  canvasTabsByProject = $state<Record<string, CanvasTab[]>>({});
  activeCanvasTabIdByProject = $state<Record<string, string | null>>({});

  visualizeTabsByProject = $state<Record<string, VisualizeTab[]>>({});
  activeVisualizeTabIdByProject = $state<Record<string, string | null>>({});

  connectionTabsByProject = $state<Record<string, ConnectionTab[]>>({});
  activeConnectionTabIdByProject = $state<Record<string, string | null>>({});

  // Saved canvases per project
  savedCanvasesByProject = $state<Record<string, SavedCanvas[]>>({});

  // === DASHBOARD TABS STATE (per-project) ===
  dashboardTabsByProject = $state<Record<string, DashboardTab[]>>({});
  activeDashboardTabIdByProject = $state<Record<string, string | null>>({});

  // === DASHBOARD DATA STATE (per-project) ===
  dashboardsByProject = $state<Record<string, Dashboard[]>>({});

  // === STARTER TABS STATE (per-project) ===
  // Shown when no connection is active
  starterTabsByProject = $state<Record<string, StarterTab[]>>({});
  activeStarterTabIdByProject = $state<Record<string, string | null>>({});

  // Tab ordering state (stores ordered array of all tab IDs per project)
  tabOrderByProject = $state<Record<string, string[]>>({});

  // === QUERY DATA STATE ===
  queryHistoryByConnection = $state<Record<string, QueryHistoryItem[]>>({});
  savedQueriesByProject = $state<Record<string, SavedQuery[]>>({});

  // === SHARED QUERY LIBRARY STATE ===
  sharedRepos = $state<SharedQueryRepo[]>([]);
  activeRepoId = $state<string | null>(null);
  sharedQueriesByRepo = $state<Record<string, SharedQuery[]>>({});
  syncStateByRepo = $state<Record<string, SyncState>>({});

  // === PROJECT GIT SYNC STATE ===
  /** Git sync state per project (for projects with gitRepoPath) */
  projectGitSyncState = $state<Record<string, SyncState>>({});

  // === SHARED CONFIG STATE (from .seaquel/ directories) ===
  /** Repo-wide shared labels from labels.yaml, keyed by repo ID */
  sharedLabelsByRepo = $state<Record<string, ConnectionLabel[]>>({});
  /** Shared projects from .seaquel/projects/, keyed by repo ID */
  sharedProjectsByRepo = $state<Record<string, SharedProject[]>>({});
  /** Shared connections keyed by shared project ID */
  sharedConnectionsByProject = $state<Record<string, SharedConnection[]>>({});
  /** Personal overrides for shared connections, keyed by shared connection ID */
  connectionOverrides = $state<Record<string, ConnectionOverride>>({});

  // === AI STATE ===
  aiMessages = $state<AIMessage[]>([]);
  isAIOpen = $state(false);
  isDashboardFullscreen = $state(false);

  // === VIEW STATE ===
  activeView = $state<
    | "query"
    | "schema"
    | "explain"
    | "erd"
    | "statistics"
    | "canvas"
    | "visualize"
    | "connection"
    | "dashboard"
  >("query");

  // === PROJECT DERIVED VALUES ===

  // Derived: active project object
  activeProject = $derived(this.projects.find((p) => p.id === this.activeProjectId) || null);

  // Derived: connections for active project
  projectConnections = $derived(
    this.activeProjectId
      ? this.connections.filter((c) => c.projectId === this.activeProjectId)
      : [],
  );

  // === CONNECTION DERIVED VALUES ===

  // Derived: active connection ID for current project
  activeConnectionId = $derived(
    this.activeProjectId ? (this.activeConnectionIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active connection object
  activeConnection = $derived(
    this.connections.find((c) => c.id === this.activeConnectionId) || null,
  );

  // Derived: schema for active connection
  activeSchema = $derived(
    this.activeConnectionId ? (this.schemas[this.activeConnectionId] ?? []) : [],
  );

  // === QUERY TAB DERIVED VALUES ===

  // Derived: query tabs for active project
  queryTabs = $derived(
    this.activeProjectId ? (this.queryTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active query tab ID for active project
  activeQueryTabId = $derived(
    this.activeProjectId ? (this.activeQueryTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active query tab object
  activeQueryTab = $derived(this.queryTabs.find((t) => t.id === this.activeQueryTabId) || null);

  // Derived: active query result (for multi-statement support)
  activeQueryResult = $derived(
    this.activeQueryTab?.results?.[this.activeQueryTab.activeResultIndex ?? 0] || null,
  );

  // === SCHEMA TAB DERIVED VALUES ===

  // Derived: schema tabs for active project
  schemaTabs = $derived(
    this.activeProjectId ? (this.schemaTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active schema tab ID for active project
  activeSchemaTabId = $derived(
    this.activeProjectId ? (this.activeSchemaTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active schema tab object
  activeSchemaTab = $derived(this.schemaTabs.find((t) => t.id === this.activeSchemaTabId) || null);

  // === EXPLAIN TAB DERIVED VALUES ===

  // Derived: explain tabs for active project
  explainTabs = $derived(
    this.activeProjectId ? (this.explainTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active explain tab ID for active project
  activeExplainTabId = $derived(
    this.activeProjectId ? (this.activeExplainTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active explain tab object
  activeExplainTab = $derived(
    this.explainTabs.find((t) => t.id === this.activeExplainTabId) || null,
  );

  // === ERD TAB DERIVED VALUES ===

  // Derived: ERD tabs for active project
  erdTabs = $derived(
    this.activeProjectId ? (this.erdTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active ERD tab ID for active project
  activeErdTabId = $derived(
    this.activeProjectId ? (this.activeErdTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active ERD tab object
  activeErdTab = $derived(this.erdTabs.find((t) => t.id === this.activeErdTabId) || null);

  // === STATISTICS TAB DERIVED VALUES ===

  // Derived: statistics tabs for active project
  statisticsTabs = $derived(
    this.activeProjectId ? (this.statisticsTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active statistics tab ID for active project
  activeStatisticsTabId = $derived(
    this.activeProjectId
      ? (this.activeStatisticsTabIdByProject[this.activeProjectId] ?? null)
      : null,
  );

  // Derived: active statistics tab object
  activeStatisticsTab = $derived(
    this.statisticsTabs.find((t) => t.id === this.activeStatisticsTabId) || null,
  );

  // === CANVAS TAB DERIVED VALUES ===

  // Derived: canvas tabs for active project
  canvasTabs = $derived(
    this.activeProjectId ? (this.canvasTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active canvas tab ID for active project
  activeCanvasTabId = $derived(
    this.activeProjectId ? (this.activeCanvasTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active canvas tab object
  activeCanvasTab = $derived(this.canvasTabs.find((t) => t.id === this.activeCanvasTabId) || null);

  // Derived: saved canvases for active project
  savedCanvases = $derived(
    this.activeProjectId ? (this.savedCanvasesByProject[this.activeProjectId] ?? []) : [],
  );

  // === VISUALIZE TAB DERIVED VALUES ===

  // Derived: visualize tabs for active project
  visualizeTabs = $derived(
    this.activeProjectId ? (this.visualizeTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active visualize tab ID for active project
  activeVisualizeTabId = $derived(
    this.activeProjectId
      ? (this.activeVisualizeTabIdByProject[this.activeProjectId] ?? null)
      : null,
  );

  // Derived: active visualize tab object
  activeVisualizeTab = $derived(
    this.visualizeTabs.find((t) => t.id === this.activeVisualizeTabId) || null,
  );

  // === CONNECTION TAB DERIVED VALUES ===

  // Derived: connection tabs for active project
  connectionTabs = $derived(
    this.activeProjectId ? (this.connectionTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active connection tab ID for active project
  activeConnectionTabId = $derived(
    this.activeProjectId
      ? (this.activeConnectionTabIdByProject[this.activeProjectId] ?? null)
      : null,
  );

  // Derived: active connection tab object
  activeConnectionTab = $derived(
    this.connectionTabs.find((t) => t.id === this.activeConnectionTabId) || null,
  );

  // === DASHBOARD TAB DERIVED VALUES ===

  // Derived: dashboard tabs for active project
  dashboardTabs = $derived(
    this.activeProjectId ? (this.dashboardTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active dashboard tab ID for active project
  activeDashboardTabId = $derived(
    this.activeProjectId
      ? (this.activeDashboardTabIdByProject[this.activeProjectId] ?? null)
      : null,
  );

  // Derived: active dashboard tab object
  activeDashboardTab = $derived(
    this.dashboardTabs.find((t) => t.id === this.activeDashboardTabId) || null,
  );

  // Derived: dashboards for active project
  projectDashboards = $derived(
    this.activeProjectId ? (this.dashboardsByProject[this.activeProjectId] ?? []) : [],
  );

  // === STARTER TAB DERIVED VALUES ===

  // Derived: starter tabs for active project
  starterTabs = $derived(
    this.activeProjectId ? (this.starterTabsByProject[this.activeProjectId] ?? []) : [],
  );

  // Derived: active starter tab ID for active project
  activeStarterTabId = $derived(
    this.activeProjectId ? (this.activeStarterTabIdByProject[this.activeProjectId] ?? null) : null,
  );

  // Derived: active starter tab object
  activeStarterTab = $derived(
    this.starterTabs.find((t) => t.id === this.activeStarterTabId) || null,
  );

  // === QUERY DATA DERIVED VALUES ===

  // Derived: query history for active connection
  activeConnectionQueryHistory = $derived(
    this.activeConnectionId ? (this.queryHistoryByConnection[this.activeConnectionId] ?? []) : [],
  );

  // Derived: saved queries for active project
  projectSavedQueries = $derived(
    this.activeProjectId ? (this.savedQueriesByProject[this.activeProjectId] ?? []) : [],
  );

  // === PROJECT GIT DERIVED VALUES ===

  // Derived: sync state for active project's git directory
  activeProjectSyncState = $derived(
    this.activeProjectId ? (this.projectGitSyncState[this.activeProjectId] ?? null) : null,
  );

  // Derived: whether active project has a git directory configured
  activeProjectHasGit = $derived(!!this.activeProject?.gitRepoPath);

  // === SHARED QUERY LIBRARY DERIVED VALUES ===

  // Derived: active shared query repo object
  activeRepo = $derived(this.sharedRepos.find((r) => r.id === this.activeRepoId) || null);

  // Derived: shared queries for active repo
  activeRepoQueries = $derived(
    this.activeRepoId ? (this.sharedQueriesByRepo[this.activeRepoId] ?? []) : [],
  );

  // Derived: sync state for active repo
  activeRepoSyncState = $derived(
    this.activeRepoId ? (this.syncStateByRepo[this.activeRepoId] ?? null) : null,
  );

  // Derived: all shared queries across all repos (for search)
  allSharedQueries = $derived(Object.values(this.sharedQueriesByRepo).flat());

  // === SHARED CONFIG DERIVED VALUES ===

  // Derived: shared labels for active repo
  activeRepoSharedLabels = $derived(
    this.activeRepoId ? (this.sharedLabelsByRepo[this.activeRepoId] ?? []) : [],
  );

  // Derived: shared projects for active repo
  activeRepoSharedProjects = $derived(
    this.activeRepoId ? (this.sharedProjectsByRepo[this.activeRepoId] ?? []) : [],
  );

  // Derived: all shared projects across all repos
  allSharedProjects = $derived(Object.values(this.sharedProjectsByRepo).flat());

  // Derived: all shared connections across all projects
  allSharedConnections = $derived(Object.values(this.sharedConnectionsByProject).flat());

  // Derived: all shared labels across all repos
  allSharedLabels = $derived(Object.values(this.sharedLabelsByRepo).flat());
}
