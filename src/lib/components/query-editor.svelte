<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { useShortcuts } from "$lib/shortcuts/index.js";
	import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { PlayIcon, DatabaseIcon, NetworkIcon, ColumnsIcon } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
import { errorToast } from "$lib/utils/toast";
	import SaveQueryDialog from "$lib/components/save-query-dialog.svelte";
	import ParameterInputDialog from "$lib/components/parameter-input-dialog.svelte";
	import { SharedQueryEditor } from "$lib/components/shared-queries/index.js";
	import MonacoEditor, { type MonacoEditorRef } from "$lib/components/monaco-editor.svelte";
	import * as Resizable from "$lib/components/ui/resizable";
	import { save } from "@tauri-apps/plugin-dialog";
	import { writeTextFile } from "@tauri-apps/plugin-fs";
	import { format as formatSQL } from "sql-formatter";
	import VirtualResultsTable from "$lib/components/virtual-results-table.svelte";
	import { formatConfig, getExportContent, type ExportFormat } from "$lib/utils/export-formats.js";
	import { m } from "$lib/paraglide/messages.js";
	import { copyCell as clipboardCopyCell, copyRowAsJSON as clipboardCopyRowAsJSON, copyColumn as clipboardCopyColumn } from "$lib/utils/clipboard";
	import { splitSqlStatements, getStatementAtOffset } from "$lib/db/sql-parser.js";
	import { hasParameters, extractParameters, createDefaultParameters } from "$lib/db/query-params.js";
	import type { QueryParameter, ParameterValue } from "$lib/types";
	import { generateSQL } from "$lib/services/ai";
	import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";
	import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
	import { getDatabase } from "$lib/storage/db";
	import QueryExampleCard from "$lib/components/empty-states/query-example-card.svelte";
	import AiModelSwitcher from "$lib/components/ai-model-switcher.svelte";
	import { sampleQueries } from "$lib/config/sample-queries.js";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import { EmptyState } from "$lib/components/ui/empty-state";

	// Import subcomponents
	import {
		QueryToolbar,
		QueryResultTabs,
		QueryPagination,
		QueryErrorDisplay,
		QueryResultsControlBar,
		ExplainResultPane,
		VisualizeResultPane,
		VisualQueryPanel
	} from "$lib/components/query-editor/index.js";
	import { schemaToQueryBuilder } from "$lib/utils/schema-adapter";

	// Import chart components
	import { QueryChart, createDefaultChartConfig } from "$lib/components/charts/index.js";
	import type { ResultViewMode, ChartConfig } from "$lib/types";
	import { DEFAULT_LAYOUT_OPTIONS, type QueryLayoutOptions } from "$lib/utils/query-visual-layout";

	let { tabId: propTabId = undefined }: { tabId?: string } = $props();

	const db = useDatabase();
	const shortcuts = useShortcuts();
	const sidebar = useSidebar();

	// Pane-aware: resolve to a specific tab instead of global active tab
	const activeTab = $derived(
		propTabId
			? db.state.queryTabs.find(t => t.id === propTabId) ?? null
			: db.state.activeQueryTab
	);
	const activeTabId = $derived(propTabId ?? db.state.activeQueryTabId);
	let showSaveDialog = $state(false);
	let showShareDialog = $state(false);
	let showParamsDialog = $state(false);
	let pendingParams = $state<QueryParameter[]>([]);
	// Track pending action type: 'query' for execute all, 'query-current' for current statement, explain or visualize details
	let pendingAction = $state<'query' | { type: 'query-current'; cursorOffset: number } | { type: 'explain'; analyze: boolean; cursorOffset: number } | { type: 'visualize'; cursorOffset: number } | null>(null);
	let deletingRowIndex = $state<number | null>(null);
	let pendingDeleteRow = $state<{ index: number; row: Record<string, unknown> } | null>(null);
	let showDeleteConfirm = $state(false);
	let monacoRef = $state<MonacoEditorRef | null>(null);

	// AI inline prompt state
	let aiInlinePromptOpen = $state(false);
	let aiInlinePromptText = $state("");
	let aiInlinePromptLoading = $state(false);
	let aiInlinePromptError = $state<{ message: string; action?: { label: string; fn: () => void } } | null>(null);

	// Get the active result (for multi-statement support)
	const activeResultIndex = $derived(activeTab?.activeResultIndex ?? 0);
	const activeResult = $derived(activeTab?.results?.[activeResultIndex] ?? null);

	// Get embedded explain/visualize results
	const explainResult = $derived(activeTab?.explainResult);
	const visualizeResult = $derived(activeTab?.visualizeResult);

	// Chart view state (per result, keyed by tab-result combination)
	let viewModeByResult = $state<Record<string, ResultViewMode>>({});
	let chartConfigByResult = $state<Record<string, ChartConfig>>({});

	// Get current view mode and chart config for active result
	const resultKey = $derived(
		activeTabId && activeResultIndex !== undefined
			? `${activeTabId}-${activeResultIndex}`
			: null
	);
	const currentViewMode = $derived<ResultViewMode>(
		resultKey ? (viewModeByResult[resultKey] ?? 'table') : 'table'
	);
	const currentChartConfig = $derived<ChartConfig | undefined>(
		resultKey && activeResult
			? (chartConfigByResult[resultKey] ?? createDefaultChartConfig(activeResult.columns, activeResult.rows))
			: undefined
	);

	const handleViewModeChange = (mode: ResultViewMode) => {
		if (resultKey) {
			viewModeByResult[resultKey] = mode;
		}
	};

	const handleChartConfigChange = (config: ChartConfig) => {
		if (resultKey) {
			chartConfigByResult[resultKey] = config;
		}
	};

	// Visualize layout options state
	let visualizeLayoutOptions = $state<QueryLayoutOptions>({ ...DEFAULT_LAYOUT_OPTIONS });

	const allResults = $derived(activeTab?.results ?? []);

	// Visual query builder panel state
	let visualPanelOpen = $state(false);
	let visualPanelGetSql: (() => string) | undefined = $state(undefined);

	// Convert database schema to query builder format
	const queryBuilderSchema = $derived(
		db.state.activeSchema ? schemaToQueryBuilder(db.state.activeSchema) : []
	);

	// Sync SQL from visual builder back to query tab when panel closes
	function syncVisualBuilderSql() {
		if (visualPanelGetSql && activeTabId) {
			const sql = visualPanelGetSql();
			db.queryTabs.updateContent(activeTabId, sql);
			currentQuery = sql;
		}
	}

	// Toggle visual panel and sync SQL when closing
	function toggleVisualPanel() {
		if (visualPanelOpen) {
			// Closing - sync SQL back
			syncVisualBuilderSql();
		}
		visualPanelOpen = !visualPanelOpen;
	}

	// Track query content for live statement count
	let currentQuery = $state(activeTab?.query ?? '');

	// Update currentQuery when active tab changes
	$effect(() => {
		currentQuery = activeTab?.query ?? '';
	});

	// Check staleness for explain/visualize results
	const isExplainStale = $derived(
		explainResult?.sourceQuery && currentQuery
			? explainResult.sourceQuery.trim() !== currentQuery.trim()
			: false
	);
	const isVisualizeStale = $derived(
		visualizeResult?.sourceQuery && currentQuery
			? visualizeResult.sourceQuery.trim() !== currentQuery.trim()
			: false
	);

	// Live statement count from current query text
	const liveStatementCount = $derived.by(() => {
		if (!currentQuery?.trim()) return 0;
		const dbType = db.state.activeConnection?.type ?? "postgres";
		return splitSqlStatements(currentQuery, dbType).length;
	});

	// Check if results are editable (have source table with primary keys)
	const isEditable = $derived(
		activeResult?.sourceTable &&
		activeResult?.sourceTable.primaryKeys.length > 0 &&
		!activeResult?.isError
	);

	// Get sample queries for the active connection type
	const activeSampleQueries = $derived(
		sampleQueries[db.state.activeConnection?.type ?? "postgres"]?.slice(0, 2) ?? []
	);

	// Handle trying a sample query
	const handleTrySampleQuery = (query: string) => {
		if (activeTabId) {
			db.queryTabs.updateContent(activeTabId, query);
		} else {
			db.queryTabs.add(undefined, query);
		}
	};

	async function handleCellSave(rowIndex: number, column: string, newValue: string) {
		if (!activeTabId || !activeResult?.sourceTable) return;

		const result = await db.queries.updateCell(
			activeTabId,
			activeResultIndex,
			rowIndex,
			column,
			newValue,
			activeResult.sourceTable
		);

		if (result.success) {
			toast.success(m.query_cell_updated());
		} else {
			errorToast(m.query_cell_update_failed({ error: result.error || '' }));
		}
	}

	function confirmDeleteRow(rowIndex: number, row: Record<string, unknown>) {
		pendingDeleteRow = { index: rowIndex, row };
		showDeleteConfirm = true;
	}

	async function handleDeleteRow() {
		if (!pendingDeleteRow || !activeTabId || !activeResult?.sourceTable) return;

		deletingRowIndex = pendingDeleteRow.index;
		showDeleteConfirm = false;

		const result = await db.queries.deleteRow(
			activeResult.sourceTable,
			pendingDeleteRow.row
		);

		if (result.success) {
			toast.success(m.query_row_deleted());
			await db.queries.execute(activeTabId);
		} else {
			errorToast(m.query_row_delete_failed({ error: result.error || '' }));
		}

		deletingRowIndex = null;
		pendingDeleteRow = null;
	}

	/**
	 * Get parameter definitions for the active query.
	 * Uses linked saved query parameters if available, otherwise creates defaults.
	 */
	const getParameterDefinitions = (query: string): QueryParameter[] => {
		const savedQueryId = activeTab?.savedQueryId;
		const savedQuery = savedQueryId
			? db.state.projectSavedQueries.find((q) => q.id === savedQueryId)
			: null;

		if (savedQuery?.parameters && savedQuery.parameters.length > 0) {
			return savedQuery.parameters;
		}

		// Create default parameters from extracted names
		const paramNames = extractParameters(query);
		return createDefaultParameters(paramNames);
	};

	const handleExecute = () => {
		if (!activeTabId || !activeTab) return;

		// Sync SQL from visual builder if open
		if (visualPanelOpen) syncVisualBuilderSql();

		const query = activeTab.query;

		// Check if query has parameters
		if (hasParameters(query)) {
			pendingParams = getParameterDefinitions(query);
			pendingAction = 'query';
			showParamsDialog = true;
		} else {
			// No parameters, execute directly
			db.queries.execute(activeTabId);
		}
	};

	const handleExecuteCurrent = () => {
		if (!activeTabId || !activeTab) return;

		// Sync SQL from visual builder if open
		if (visualPanelOpen) syncVisualBuilderSql();

		const query = activeTab.query;
		const cursorOffset = monacoRef?.getCursorOffset() ?? 0;
		const dbType = db.state.activeConnection?.type ?? "postgres";

		// Get the current statement to check for parameters
		const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);

		// Only check parameters on the current statement, not the entire query
		if (currentStatement && hasParameters(currentStatement.sql)) {
			pendingParams = getParameterDefinitions(currentStatement.sql);
			pendingAction = { type: 'query-current', cursorOffset };
			showParamsDialog = true;
		} else {
			// No parameters in current statement, execute directly
			db.queries.executeCurrent(activeTabId, cursorOffset);
		}
	};

	const handleParamExecute = (values: ParameterValue[]) => {
		if (!activeTabId) return;

		if (pendingAction === 'query') {
			db.queries.executeWithParams(activeTabId, values);
		} else if (pendingAction && typeof pendingAction === 'object' && pendingAction.type === 'query-current') {
			db.queries.executeCurrentWithParams(
				activeTabId,
				pendingAction.cursorOffset,
				values
			);
		} else if (pendingAction && typeof pendingAction === 'object' && pendingAction.type === 'explain') {
			db.explainTabs.executeEmbeddedWithParams(
				activeTabId,
				values,
				pendingAction.analyze,
				pendingAction.cursorOffset
			);
			// Switch view mode to explain
			if (resultKey) {
				viewModeByResult[resultKey] = 'explain';
			}
		} else if (pendingAction && typeof pendingAction === 'object' && pendingAction.type === 'visualize') {
			const success = db.visualizeTabs.visualizeEmbeddedWithParams(
				activeTabId,
				values,
				pendingAction.cursorOffset
			);
			// Switch view mode to visualize
			if (success && resultKey) {
				viewModeByResult[resultKey] = 'visualize';
			}
		}
		pendingAction = null;
	};

	const handleParamCancel = () => {
		pendingAction = null;
	};

	const handleExplain = (analyze: boolean) => {
		if (!activeTabId || !activeTab) return;

		// Sync SQL from visual builder if open
		if (visualPanelOpen) syncVisualBuilderSql();

		const query = activeTab.query;
		const cursorOffset = monacoRef?.getCursorOffset() ?? 0;

		// Check if query has parameters
		if (hasParameters(query)) {
			pendingParams = getParameterDefinitions(query);
			pendingAction = { type: 'explain', analyze, cursorOffset };
			showParamsDialog = true;
		} else {
			// No parameters, execute embedded explain
			db.explainTabs.executeEmbedded(activeTabId, analyze, cursorOffset);
			// Switch view mode to explain
			if (resultKey) {
				viewModeByResult[resultKey] = 'explain';
			}
		}
	};

	const handleVisualize = () => {
		if (!activeTabId || !activeTab) return;

		// Sync SQL from visual builder if open
		if (visualPanelOpen) syncVisualBuilderSql();

		const query = activeTab.query;
		const cursorOffset = monacoRef?.getCursorOffset() ?? 0;
		const dbType = db.state.activeConnection?.type ?? "postgres";

		// Get the current statement to check for parameters
		const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);
		const queryToCheck = currentStatement?.sql ?? query;

		// Check if query has parameters
		if (hasParameters(queryToCheck)) {
			pendingParams = getParameterDefinitions(queryToCheck);
			pendingAction = { type: 'visualize', cursorOffset };
			showParamsDialog = true;
		} else {
			// No parameters, visualize directly
			const success = db.visualizeTabs.visualizeEmbedded(activeTabId, cursorOffset);
			// Switch view mode to visualize
			if (success && resultKey) {
				viewModeByResult[resultKey] = 'visualize';
			}
		}
	};

	const handleRefreshExplain = (analyze: boolean) => {
		if (!activeTabId || !activeTab) return;

		const query = activeTab.query;
		const cursorOffset = monacoRef?.getCursorOffset() ?? 0;
		const dbType = db.state.activeConnection?.type ?? "postgres";

		// Get the current statement to check for parameters
		const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);
		const queryToCheck = currentStatement?.sql ?? query;

		// Check if query has parameters
		if (hasParameters(queryToCheck)) {
			pendingParams = getParameterDefinitions(queryToCheck);
			pendingAction = { type: 'explain', analyze, cursorOffset };
			showParamsDialog = true;
		} else {
			// No parameters, execute directly
			db.explainTabs.executeEmbedded(activeTabId, analyze, cursorOffset);
		}
	};

	const handleRefreshVisualize = () => {
		if (!activeTabId || !activeTab) return;

		const query = activeTab.query;
		const cursorOffset = monacoRef?.getCursorOffset() ?? 0;
		const dbType = db.state.activeConnection?.type ?? "postgres";

		// Get the current statement to check for parameters
		const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);
		const queryToCheck = currentStatement?.sql ?? query;

		// Check if query has parameters
		if (hasParameters(queryToCheck)) {
			pendingParams = getParameterDefinitions(queryToCheck);
			pendingAction = { type: 'visualize', cursorOffset };
			showParamsDialog = true;
		} else {
			// No parameters, visualize directly
			db.visualizeTabs.visualizeEmbedded(activeTabId, cursorOffset);
		}
	};

	const handleCloseExplain = () => {
		if (!activeTabId) return;
		db.queryTabs.clearExplainResult(activeTabId);
		// Switch back to table view
		if (resultKey) {
			viewModeByResult[resultKey] = 'table';
		}
	};

	const handleCloseVisualize = () => {
		if (!activeTabId) return;
		db.queryTabs.clearVisualizeResult(activeTabId);
		// Switch back to table view
		if (resultKey) {
			viewModeByResult[resultKey] = 'table';
		}
	};

	const handleSave = () => {
		if (!activeTab?.query.trim()) return;
		showSaveDialog = true;
	};

	const handleShare = () => {
		if (!activeTab?.query.trim()) return;
		showShareDialog = true;
	};

	const handleFormat = () => {
		if (!activeTab?.query.trim()) return;
		try {
			const formatted = formatSQL(activeTab.query, {
				language: "postgresql",
				tabWidth: 2,
				keywordCase: "upper"
			});
			db.queryTabs.updateContent(activeTabId!, formatted);
		} catch {
			errorToast(m.query_format_failed());
		}
	};

	const getContent = (format: ExportFormat): string => {
		if (!activeResult) return format === "json" ? "[]" : "";
		return getExportContent(format, activeResult.columns, activeResult.rows);
	};

	const handleExport = async (format: ExportFormat) => {
		if (!activeResult) return;

		const config = formatConfig[format];
		const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
		const defaultName = `query_results_${timestamp}.${config.extension}`;
		const filters = [{ name: config.name, extensions: [config.extension] }];

		const filePath = await save({
			defaultPath: defaultName,
			filters
		});

		if (!filePath) return;

		const content = getContent(format);
		await writeTextFile(filePath, content);
	};

	const handleCopy = async (format: ExportFormat) => {
		if (!activeResult) return;

		const content = getContent(format);
		const formatNames: Record<ExportFormat, string> = {
			csv: "CSV",
			json: "JSON",
			sql: "SQL INSERT",
			markdown: "Markdown"
		};

		try {
			await navigator.clipboard.writeText(content);
			toast.success(m.query_copied_to_clipboard({ format: formatNames[format] }));
		} catch {
			errorToast(m.query_copy_failed());
		}
	};

	// Context menu for copying cells
	let contextCell = $state<{ value: unknown; column: string; row: Record<string, unknown> } | null>(null);

	const handleCellRightClick = (value: unknown, column: string, row: Record<string, unknown>) => {
		contextCell = { value, column, row };
	};

	const copyCell = async () => {
		if (!contextCell) return;
		await clipboardCopyCell(contextCell.value);
	};

	const copyRowAsJSON = async () => {
		if (!contextCell) return;
		await clipboardCopyRowAsJSON(contextCell.row);
	};

	const copyColumn = async () => {
		if (!contextCell || !activeResult) return;
		await clipboardCopyColumn(contextCell.column, activeResult.rows);
	};

	// AI inline prompt handlers
	function handleAIInlinePrompt(_pos: { lineNumber: number; column: number }) {
		aiInlinePromptText = "";
		aiInlinePromptError = null;
		aiInlinePromptOpen = true;
	}

	async function submitAIInlinePrompt() {
		if (!aiInlinePromptText.trim() || aiInlinePromptLoading) return;
		aiInlinePromptLoading = true;
		try {
			const activeConn = db.state.activeConnection;
			const shareSchema = activeConn?.aiShareSchema !== undefined
				? activeConn.aiShareSchema
				: aiSettingsStore.settings.shareSchemaGlobally;
			const activeProviderId = activeConn?.activeAIProviderId ?? null;
			const activeModel = activeConn?.activeAIModel ?? null;

			if (!activeProviderId || !activeModel) {
				if (aiSettingsStore.settings.providers.length === 0) {
					aiInlinePromptError = {
						message: "No AI provider configured.",
						action: {
							label: "Configure",
							fn: () => { settingsDialogStore.open("ai-provider"); closeAIInlinePrompt(); },
						},
					};
				} else {
					aiInlinePromptError = {
						message: "No model selected. Pick one from the model switcher to the right.",
					};
				}
				aiInlinePromptLoading = false;
				return;
			}

			const sql = await generateSQL({
				request: aiInlinePromptText,
				existingQuery: activeTab?.query ?? "",
				schema: db.state.activeSchema ?? [],
				shareSchema,
				providerId: activeProviderId,
				model: activeModel,
				databaseType: db.state.activeConnection?.type,
			});
			monacoRef?.insertText(sql);
			aiInlinePromptOpen = false;
			aiInlinePromptText = "";
			handleExecute();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "no_provider") {
				aiInlinePromptError = {
					message: "No AI provider configured.",
					action: {
						label: "Configure",
						fn: () => { settingsDialogStore.open("ai-provider"); closeAIInlinePrompt(); },
					},
				};
			} else if (msg === "no_api_key") {
				aiInlinePromptError = {
					message: "No API key configured.",
					action: {
						label: "Settings → AI",
						fn: () => { settingsDialogStore.open("ai-provider"); closeAIInlinePrompt(); },
					},
				};
			} else if (msg === "rate_limit") {
				aiInlinePromptError = { message: "Rate limit reached. Please wait and try again." };
			} else {
				aiInlinePromptError = { message: "Something went wrong. Please try again." };
				toast.error(msg);
			}
		} finally {
			aiInlinePromptLoading = false;
		}
	}

	function closeAIInlinePrompt() {
		aiInlinePromptOpen = false;
		aiInlinePromptText = "";
		aiInlinePromptLoading = false;
		aiInlinePromptError = null;
	}

	const focusOnMount = () => (el: HTMLInputElement) => {
		el.focus();
	};

	// Register keyboard shortcuts
	onMount(() => {
		shortcuts.registerHandler('saveQuery', handleSave);
		shortcuts.registerHandler('formatSql', handleFormat);
	});

	onDestroy(() => {
		shortcuts.unregisterHandler('saveQuery');
		shortcuts.unregisterHandler('formatSql');
	});
</script>

<div class="flex flex-col h-full overflow-hidden">
	{#if activeTab}
		<div class="flex items-center justify-between border-b bg-muted/30 shrink-0">
			<div class="flex-1">
				<QueryToolbar
					isExecuting={activeTab.isExecuting}
					hasQuery={!!activeTab.query.trim()}
					{activeResult}
					{liveStatementCount}
					onExecute={handleExecute}
					onExecuteCurrent={handleExecuteCurrent}
					onExplain={handleExplain}
					onVisualize={handleVisualize}
					onFormat={handleFormat}
					onSave={handleSave}
					onShare={handleShare}
				/>
			</div>
			<!-- Visual Builder Toggle -->
			{#if queryBuilderSchema.length > 0}
				<div class="pe-2 shrink-0">
					<Button
						size="sm"
						variant="outline"
						class="h-7 gap-1.5 {visualPanelOpen ? 'bg-secondary border-secondary-foreground/30' : ''}"
						onclick={toggleVisualPanel}
					>
						<ColumnsIcon class="size-3.5" />
						{m.query_visual_builder()}
					</Button>
				</div>
			{/if}
		</div>

		<Resizable.PaneGroup direction="vertical" class="flex-1 min-h-0">
			<!-- Editor Pane (visual builder or plain SQL editor) -->
			<Resizable.Pane defaultSize={40} minSize={15}>
				{#if visualPanelOpen && queryBuilderSchema.length > 0}
					<!-- Visual Builder (includes canvas, filter panel, and SQL editor) -->
					<div class="h-full">
						{#key activeTabId}
							<VisualQueryPanel
								schema={queryBuilderSchema}
								monacoSchema={db.state.activeSchema ?? undefined}
								initialSql={activeTab.query}
								bind:getSql={visualPanelGetSql}
							/>
						{/key}
					</div>
				{:else}
					<!-- Just SQL Editor -->
					<div class="relative h-full">
						{#key activeTabId}
							<MonacoEditor
								bind:value={activeTab.query}
								bind:ref={monacoRef}
								schema={db.state.activeSchema}
								onExecute={handleExecuteCurrent}
								onToggleSidebar={() => sidebar.toggle()}
								onAIInlinePrompt={aiSettingsStore.settings.enabled ? handleAIInlinePrompt : undefined}
								onChange={(newValue) => {
									currentQuery = newValue;
									if (activeTabId) {
										db.queryTabs.updateContent(activeTabId, newValue);
									}
								}}
							/>
						{/key}
						{#if aiInlinePromptOpen}
							<div
								class="absolute top-12 left-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-lg"
								role="dialog"
								aria-label="AI query prompt"
							>
								<svg class="h-4 w-4 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
								<input
									type="text"
									class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
									placeholder="Ask AI to write a query..."
									bind:value={aiInlinePromptText}
									disabled={aiInlinePromptLoading}
									oninput={() => { aiInlinePromptError = null; }}
									onkeydown={(e) => {
										if (e.key === "Enter") { e.preventDefault(); submitAIInlinePrompt(); }
										if (e.key === "Escape") { e.preventDefault(); closeAIInlinePrompt(); }
									}}
									{@attach focusOnMount()}
								/>
								{#if aiInlinePromptLoading}
									<span class="text-xs text-muted-foreground">Thinking...</span>
								{:else if aiInlinePromptError}
									<span class="text-xs text-destructive">
										{aiInlinePromptError.message}
										{#if aiInlinePromptError.action}
											<button
												class="underline hover:no-underline"
												onclick={aiInlinePromptError.action.fn}
											>{aiInlinePromptError.action.label}</button>
										{/if}
									</span>
									{#if !aiInlinePromptError.action && aiSettingsStore.settings.providers.length > 0}
										<AiModelSwitcher
											providerId={db.state.activeConnection?.activeAIProviderId ?? null}
											model={db.state.activeConnection?.activeAIModel ?? null}
											onSelect={async (pid, mod) => {
												const conn = db.state.activeConnection;
												if (!conn) return;
												await db.setConnectionAIModel(conn.id, pid, mod);
												aiInlinePromptError = null;
												submitAIInlinePrompt();
											}}
										/>
									{/if}
									<button
										class="shrink-0 text-xs text-muted-foreground hover:text-foreground"
										onclick={closeAIInlinePrompt}
										aria-label="Close"
									>ESC</button>
								{:else}
									<AiModelSwitcher
										providerId={db.state.activeConnection?.activeAIProviderId ?? null}
										model={db.state.activeConnection?.activeAIModel ?? null}
										onSelect={async (pid, mod) => {
											const conn = db.state.activeConnection;
											if (!conn) return;
											await db.setConnectionAIModel(conn.id, pid, mod);
										}}
									/>
									<button
										class="shrink-0 text-xs text-muted-foreground hover:text-foreground"
										onclick={closeAIInlinePrompt}
										aria-label="Close"
									>ESC</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</Resizable.Pane>

			<Resizable.Handle withHandle />

			<!-- Results Pane -->
			<Resizable.Pane defaultSize={60} minSize={15}>
				<div class="h-full flex flex-col overflow-hidden">
					{#if allResults.length > 0}
						<QueryResultTabs
							results={allResults}
							activeIndex={activeResultIndex}
							onSelectResult={(i) => db.queries.setActiveResult(activeTabId!, i)}
						/>

						{#if activeResult && !activeResult.isError}
							<QueryResultsControlBar
								{currentViewMode}
								onViewModeChange={handleViewModeChange}
								{explainResult}
								{visualizeResult}
								{isExplainStale}
								{isVisualizeStale}
								{currentChartConfig}
								{activeResult}
								onChartConfigChange={handleChartConfigChange}
								onExport={handleExport}
								onCopy={handleCopy}
								onRefreshExplain={handleRefreshExplain}
								onCloseExplain={handleCloseExplain}
								{visualizeLayoutOptions}
								onVisualizeLayoutChange={(opts) => visualizeLayoutOptions = opts}
								onRefreshVisualize={handleRefreshVisualize}
								onCloseVisualize={handleCloseVisualize}
							/>
						{:else if (explainResult?.result || explainResult?.isExecuting || visualizeResult?.parsedQuery || visualizeResult?.parseError)}
							<QueryResultsControlBar
								{currentViewMode}
								onViewModeChange={handleViewModeChange}
								{explainResult}
								{visualizeResult}
								{isExplainStale}
								{isVisualizeStale}
								onRefreshExplain={handleRefreshExplain}
								onCloseExplain={handleCloseExplain}
								{visualizeLayoutOptions}
								onVisualizeLayoutChange={(opts) => visualizeLayoutOptions = opts}
								onRefreshVisualize={handleRefreshVisualize}
								onCloseVisualize={handleCloseVisualize}
							/>
						{/if}

						{#if currentViewMode === 'explain' && explainResult}
							<ExplainResultPane {explainResult} />
						{:else if currentViewMode === 'explain' && !explainResult}
							<EmptyState
								icon={DatabaseIcon}
								title="No Explain Results"
								description="Analyze your query's execution plan to understand how the database processes it."
							>
								{#snippet actions()}
									<div class="flex gap-2 justify-center">
										<Button size="sm" variant="outline" onclick={() => handleExplain(false)}>
											Explain
										</Button>
										<Button size="sm" onclick={() => handleExplain(true)}>
											Explain Analyze
										</Button>
									</div>
								{/snippet}
							</EmptyState>
						{:else if currentViewMode === 'visualize' && visualizeResult}
							<VisualizeResultPane
								{visualizeResult}
								layoutOptions={visualizeLayoutOptions}
							/>
						{:else if currentViewMode === 'visualize' && !visualizeResult}
							<EmptyState
								icon={NetworkIcon}
								title="No Visual Results"
								description="See a visual representation of your query structure."
							>
								{#snippet actions()}
									<Button size="sm" onclick={handleVisualize}>
										Visualize Query
									</Button>
								{/snippet}
							</EmptyState>
						{:else if activeResult?.isError}
							<QueryErrorDisplay
								statementIndex={activeResultIndex}
								error={activeResult.error ?? ''}
								statementSql={activeResult.statementSql}
							/>
						{:else if activeResult}
							{#if currentViewMode === 'chart'}
								<div class="flex-1 min-h-0">
									<QueryChart
										columns={activeResult.columns}
										rows={activeResult.rows}
										config={currentChartConfig}
										onConfigChange={handleChartConfigChange}
									/>
								</div>
							{:else}
								<VirtualResultsTable
									columns={activeResult.columns}
									rows={activeResult.rows}
									isEditable={!!isEditable}
									onCellSave={handleCellSave}
									onRowDelete={confirmDeleteRow}
									{deletingRowIndex}
									onCopyCell={copyCell}
									onCopyRow={copyRowAsJSON}
									onCopyColumn={copyColumn}
									onCellRightClick={handleCellRightClick}
								/>
							{/if}

							{#if (activeResult.totalPages > 1 || activeResult.pageSize === 0) && currentViewMode === 'table'}
								<QueryPagination
									page={activeResult.page}
									pageSize={activeResult.pageSize}
									totalPages={activeResult.totalPages}
									totalRows={activeResult.totalRows}
									isExecuting={activeTab.isExecuting}
									onGoToPage={(page) => db.queries.goToPage(activeTabId!, page)}
									onSetPageSize={(size) => db.queries.setPageSize(activeTabId!, size)}
								/>
							{/if}
						{/if}
					{:else}
						<!-- Show view toggle and content even without query results -->
						<QueryResultsControlBar
							{currentViewMode}
							onViewModeChange={handleViewModeChange}
							{explainResult}
							{visualizeResult}
							{isExplainStale}
							{isVisualizeStale}
							onRefreshExplain={handleRefreshExplain}
							onCloseExplain={handleCloseExplain}
							onRefreshVisualize={handleRefreshVisualize}
							onCloseVisualize={handleCloseVisualize}
						/>
						{#if currentViewMode === 'explain' && explainResult}
							<ExplainResultPane {explainResult} />
						{:else if currentViewMode === 'explain' && !explainResult}
							<EmptyState
								icon={DatabaseIcon}
								title="No Explain Results"
								description="Analyze your query's execution plan to understand how the database processes it."
							>
								{#snippet actions()}
									<div class="flex gap-2 justify-center">
										<Button size="sm" variant="outline" onclick={() => handleExplain(false)}>
											Explain
										</Button>
										<Button size="sm" onclick={() => handleExplain(true)}>
											Explain Analyze
										</Button>
									</div>
								{/snippet}
							</EmptyState>
						{:else if currentViewMode === 'visualize' && visualizeResult}
							<VisualizeResultPane
								{visualizeResult}
								layoutOptions={visualizeLayoutOptions}
							/>
						{:else if currentViewMode === 'visualize' && !visualizeResult}
							<EmptyState
								icon={NetworkIcon}
								title="No Visual Results"
								description="See a visual representation of your query structure."
							>
								{#snippet actions()}
									<Button size="sm" onclick={handleVisualize}>
										Visualize Query
									</Button>
								{/snippet}
							</EmptyState>
						{:else}
							<div class="flex-1 overflow-auto p-6">
								<div class="w-full max-w-md space-y-6 mx-auto my-auto min-h-full flex flex-col justify-center">
									<div class="text-center">
										<PlayIcon class="size-10 mx-auto mb-2 opacity-20" />
										<p class="font-medium">{m.query_no_results()}</p>
										<p class="text-xs text-muted-foreground mt-1">
											{m.query_run_hint({ shortcut: "⌘+Enter" })}
										</p>
									</div>

									{#if activeSampleQueries.length > 0 && !currentQuery?.trim()}
										<div class="space-y-3">
											<p class="text-xs text-muted-foreground text-center">
												{m.empty_query_sample_title()}
											</p>
											{#each activeSampleQueries as sampleQuery}
												<QueryExampleCard query={sampleQuery} onTry={handleTrySampleQuery} />
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{:else}
		<div class="flex-1 flex items-center justify-center p-6">
			<div class="w-full max-w-md space-y-6">
				<div class="text-center">
					<PlayIcon class="size-10 mx-auto mb-2 opacity-20" />
					<p class="font-medium">{m.query_create_tab()}</p>
				</div>
				<Button class="w-full" onclick={() => db.queryTabs.add()}>
					<PlusIcon class="size-4 me-2" />
					{m.empty_query_new()}
				</Button>
			</div>
		</div>
	{/if}
</div>

{#if activeTab}
	<SaveQueryDialog
		bind:open={showSaveDialog}
		query={activeTab.query}
		tabId={activeTab.id}
	/>

	<SharedQueryEditor
		bind:open={showShareDialog}
		onOpenChange={(open) => showShareDialog = open}
		query={activeTab.query}
		name={activeTab.name}
	/>

	<ParameterInputDialog
		bind:open={showParamsDialog}
		parameters={pendingParams}
		onExecute={handleParamExecute}
		onCancel={handleParamCancel}
	/>
{/if}

<!-- Delete Row Confirmation Dialog -->
<Dialog.Root bind:open={showDeleteConfirm}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.query_delete_row_title()}</Dialog.Title>
			<Dialog.Description>
				{m.query_delete_row_description()}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showDeleteConfirm = false)}>
				{m.query_cancel()}
			</Button>
			<Button variant="destructive" onclick={handleDeleteRow}>
				{m.query_delete()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
