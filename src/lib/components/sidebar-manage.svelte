<script lang="ts">
	import { SvelteSet } from "svelte/reactivity";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { formatRelativeTime } from "$lib/utils.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
	import { TableIcon, ChevronRightIcon, FolderIcon, HistoryIcon, StarIcon, ClockIcon, BookmarkIcon, Trash2Icon, SearchIcon, DatabaseIcon, FileTextIcon, PlusIcon, PlugIcon, UnplugIcon, TagIcon, BarChart3Icon, NetworkIcon, LayoutGridIcon, WorkflowIcon, MoreHorizontalIcon, GitBranchIcon, PencilIcon, RefreshCwIcon, LoaderIcon, LayoutDashboardIcon } from "@lucide/svelte";
	import type { Dashboard } from "$lib/types";
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "$lib/components/ui/collapsible";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import DeleteConfirmDialog from "$lib/components/delete-confirm-dialog.svelte";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { m } from "$lib/paraglide/messages.js";
	import { isDemo, getFeatures } from "$lib/features";
	import ConnectionLabelPicker from "$lib/components/connection-label-picker.svelte";
	import { buildDeepLinkUrl } from "$lib/services/deep-link";
	import { LinkIcon, SettingsIcon } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
    import { snippets } from "monaco-sql-languages";

	interface Props {
		version?: string;
	}

	let { version = "" }: Props = $props();

	const db = useDatabase();
	const features = getFeatures();

	const hasActiveConnection = $derived(
		!!db.state.activeConnectionId && !!db.state.activeConnection &&
		!!(db.state.activeConnection.providerConnectionId)
	);

	let sidebarTab = $state<"schema" | "queries" | "dashboards">(db.state.activeConnectionId ? "schema" : "queries");

	// When connection becomes inactive, switch away from schema tab
	$effect(() => {
		if (!hasActiveConnection && sidebarTab === "schema") {
			sidebarTab = "queries";
		}
	});

	let connectionsExpanded = $state(true);
	let expandedSchemas = new SvelteSet<string>();
	let historyExpanded = $state(true);
	let starredExpanded = $state(true);
	let localExpanded = $state(true);
	let sharedExpanded = $state(true);
	let searchQuery = $state("");
	let schemaSearchQuery = $state("");
	let isRefreshingSchema = $state(false);

	// Remove connection confirmation dialog state
	let showRemoveDialog = $state(false);
	let connectionToRemove = $state<string | null>(null);
	let connectionToRemoveName = $state("");

	// Delete query confirmation dialog state
	let showDeleteQueryDialog = $state(false);
	let queryToDelete = $state<{ id: string; name: string; type: "saved" | "shared" } | null>(null);

	const confirmDeleteQuery = () => {
		if (!queryToDelete) return;
		db.savedQueries.deleteQuery(queryToDelete.id);
		showDeleteQueryDialog = false;
		queryToDelete = null;
	};

	// Delete dashboard confirmation dialog state
	let showDeleteDashboardDialog = $state(false);
	let dashboardToDelete = $state<{ id: string; name: string; type: "local" | "shared" } | null>(null);

	const confirmDeleteDashboard = () => {
		if (!dashboardToDelete) return;
		db.dashboards.deleteDashboard(dashboardToDelete.id);
		const tabsToClose = db.state.dashboardTabs.filter(
			(t) => t.dashboardId === dashboardToDelete!.id
		);
		for (const t of tabsToClose) {
			db.dashboardTabs.remove(t.id);
		}
		showDeleteDashboardDialog = false;
		dashboardToDelete = null;
	};

	// Labels dialog state
	let showLabelsDialog = $state(false);
	let connectionToEditLabels = $state<string | null>(null);
	let connectionToEditLabelsName = $state("");

	const toggleSchema = (schemaName: string) => {
		if (expandedSchemas.has(schemaName)) {
			expandedSchemas.delete(schemaName);
		} else {
			expandedSchemas.add(schemaName);
		}
	};

	// Filter and group tables by schema
	const tablesBySchema = $derived.by(() => {
		const searchLower = schemaSearchQuery.toLowerCase();
		const filtered = schemaSearchQuery
			? db.state.activeSchema.filter(table =>
				table.name.toLowerCase().includes(searchLower) ||
				(table.schema || "").toLowerCase().includes(searchLower)
			)
			: db.state.activeSchema;

		const grouped = new Map<string, typeof db.state.activeSchema>();
		filtered.forEach((table) => {
			const schema = table.schema || "default";
			if (!grouped.has(schema)) {
				grouped.set(schema, []);
			}
			grouped.get(schema)!.push(table);
		});
		return grouped;
	});

	const handleRefreshSchema = async () => {
		if (!db.state.activeConnectionId || isRefreshingSchema) return;
		isRefreshingSchema = true;
		try {
			await db.connections.refreshSchema(db.state.activeConnectionId);
		} catch (error) {
			console.error("Failed to refresh schema:", error);
		} finally {
			isRefreshingSchema = false;
		}
	};

	const handleTableClick = (table: (typeof db.state.activeSchema)[0]) => {
		db.schemaTabs.add(table);
		db.ui.setActiveView("schema");
	};

	const filteredHistory = $derived(
		db.state.activeConnectionQueryHistory.filter((item) =>
			item.query.toLowerCase().includes(searchQuery.toLowerCase()),
		),
	);

	// All queries filtered by search
	const filteredQueries = $derived(
		db.state.projectQueries.filter(
			(item) =>
				item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.query.toLowerCase().includes(searchQuery.toLowerCase()),
		),
	);

	// For backward compat: shared queries filtered by search
	const filteredSharedQueries = $derived(filteredQueries.filter((q) => q.shared));

	// For backward compat: local queries filtered by search
	const filteredSavedQueries = $derived(filteredQueries.filter((q) => !q.shared));

	// Starred queries (both local and shared)
	const starredSavedQueries = $derived(
		filteredSavedQueries.filter((item) => item.starred),
	);
	const starredSharedQueries = $derived(
		filteredSharedQueries.filter((item) => item.starred),
	);
	const totalStarredCount = $derived(starredSavedQueries.length + starredSharedQueries.length);

	// Local queries: non-shared, non-starred
	const localQueries = $derived(
		filteredSavedQueries.filter((item) => !item.starred),
	);

	// Shared queries: shared, non-starred
	const nonStarredSharedQueries = $derived(
		filteredSharedQueries.filter((item) => !item.starred),
	);

	const handleQueryClick = (query: typeof db.state.projectQueries[0]) => {
		db.queryTabs.loadQuery(query.id, () => db.ui.setActiveView("query"));
	};

	const handleShareQuery = async (item: typeof db.state.projectQueries[0]) => {
		try {
			await db.savedQueries.shareQuery(item.id);
		} catch (error) {
			console.error("Failed to share query:", error);
		}
	};

	const handleUnshareQuery = async (queryId: string) => {
		try {
			await db.savedQueries.unshareQuery(queryId);
		} catch (error) {
			console.error("Failed to unshare query:", error);
		}
	};

	const handleConnectionClick = async (connection: typeof db.state.connections[0]) => {
		// If connection has a database instance, just activate it
		if (connection.providerConnectionId) {
			db.connections.setActive(connection.id);
		} else {
			// Try auto-reconnect first if password is saved
			const autoReconnected = await db.connections.autoReconnect(connection.id);
			if (autoReconnected) {
				return; // Successfully reconnected
			}

			// Fall back to dialog if auto-reconnect fails or password not saved
			void db.connectionTabs.open({
				id: connection.id,
				name: connection.name,
				type: connection.type,
				host: connection.host,
				port: connection.port,
				databaseName: connection.databaseName,
				username: connection.username,
				sslMode: connection.sslMode,
				connectionString: connection.connectionString,
				sshTunnel: connection.sshTunnel,
				savePassword: connection.savePassword,
				saveSshPassword: connection.saveSshPassword,
				saveSshKeyPassphrase: connection.saveSshKeyPassphrase,
			});
		}
	};

	const confirmRemoveConnection = (connectionId: string, name: string) => {
		connectionToRemove = connectionId;
		connectionToRemoveName = name;
		showRemoveDialog = true;
	};

	const handleRemoveConnection = () => {
		if (connectionToRemove) {
			db.connections.remove(connectionToRemove);
			connectionToRemove = null;
			connectionToRemoveName = "";
		}
		showRemoveDialog = false;
	};

	// Get labels for a connection
	const getConnectionLabels = (connection: typeof db.state.connections[0]) => {
		return db.labels.getConnectionLabelsById(connection.id);
	};

	const openLabelsDialog = (connectionId: string, name: string) => {
		connectionToEditLabels = connectionId;
		connectionToEditLabelsName = name;
		showLabelsDialog = true;
	};

	const copyShareLink = async (resource: { repoId?: string; filePath?: string; name?: string; folder?: string }, resourceType: "query" | "dashboard" | "connection" = "query") => {
		// For unified Query/Dashboard objects, derive repoId from active repo and filePath from name+folder
		const repoId = resource.repoId ?? db.state.activeRepoId;
		if (!repoId) {
			toast.error("No repository configured");
			return;
		}
		const repo = db.state.sharedRepos.find((r) => r.id === repoId);
		if (!repo || !repo.remoteUrl) {
			toast.error("This repository has no remote URL configured");
			return;
		}
		let filePath = resource.filePath;
		if (!filePath && resource.name) {
			const { nameToFilename } = await import("$lib/services/config-file-parser");
			const project = db.state.activeProject;
			const projectDir = project ? nameToFilename(project.name) : "";
			if (resourceType === "dashboard") {
				const { dashboardNameToFilename } = await import("$lib/services/dashboard-file-parser");
				const filename = dashboardNameToFilename(resource.name);
				filePath = `.seaquel/projects/${projectDir}/dashboards/${filename}`;
			} else {
				const { queryNameToFilename } = await import("$lib/services/query-file-parser");
				const filename = queryNameToFilename(resource.name);
				const folder = resource.folder || "";
				const relPath = folder ? `${folder}/${filename}` : filename;
				filePath = `.seaquel/projects/${projectDir}/queries/${relPath}`;
			}
		}
		if (!filePath) {
			toast.error("Cannot generate share link");
			return;
		}
		const url = buildDeepLinkUrl(repo.remoteUrl, repo.branch, filePath);
		await navigator.clipboard.writeText(url);
		toast.success("Link copied to clipboard");
	};

	// Dashboard section state
	let dashboardStarredExpanded = $state(true);
	let dashboardLocalExpanded = $state(true);
	let dashboardSharedExpanded = $state(true);
	let dashboardSearchQuery = $state("");

	// All dashboards filtered by search
	const filteredAllDashboards = $derived(
		db.state.projectDashboards.filter(
			(item) => item.name.toLowerCase().includes(dashboardSearchQuery.toLowerCase()),
		),
	);

	// Shared dashboards filtered by search
	const filteredSharedDashboards = $derived(filteredAllDashboards.filter((d) => d.shared));

	// Local dashboards filtered by search
	const filteredLocalDashboards = $derived(filteredAllDashboards.filter((d) => !d.shared));

	// Starred dashboards
	const starredLocalDashboards = $derived(
		filteredLocalDashboards.filter((item) => item.starred),
	);
	const starredSharedDashboards = $derived(
		filteredSharedDashboards.filter((item) => item.starred),
	);
	const totalStarredDashboardCount = $derived(starredLocalDashboards.length + starredSharedDashboards.length);

	// Non-starred local dashboards
	const nonStarredLocalDashboards = $derived(
		filteredLocalDashboards.filter((item) => !item.starred),
	);

	// Non-starred shared dashboards
	const nonStarredSharedDashboards = $derived(
		filteredSharedDashboards.filter((item) => !item.starred),
	);

	const handleShareDashboard = async (dashboard: Dashboard) => {
		try {
			await db.dashboards.shareDashboardById(dashboard.id);
		} catch (error) {
			console.error("Failed to share dashboard:", error);
		}
	};

	const handleUnshareDashboard = async (dashboardId: string) => {
		try {
			await db.dashboards.unshareDashboardById(dashboardId);
		} catch (error) {
			console.error("Failed to unshare dashboard:", error);
		}
	};

	const handleSharedDashboardClick = (dashboard: Dashboard) => {
		db.dashboardTabs.add(dashboard.id, dashboard.name);
	};
</script>

<!-- Header: Connections section -->
<Sidebar.Header class="p-0 py-1">
	<Sidebar.Group class="py-2">
		<Collapsible bind:open={connectionsExpanded}>
			<div class="flex items-center justify-between px-3 py-1">
				<CollapsibleTrigger class="flex items-center gap-1 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground">
					<ChevronRightIcon class={["size-3 transition-transform", connectionsExpanded && "rotate-90"]} />
					{m.sidebar_connections()}
				</CollapsibleTrigger>
				{#if features.newConnections}
					<Button
						size="icon"
						variant="ghost"
						class="size-5 [&_svg:not([class*='size-'])]:size-3"
						onclick={() => void db.connectionTabs.open()}
						title={m.sidebar_connections_add()}
					>
						<PlusIcon />
					</Button>
				{/if}
			</div>
			<CollapsibleContent>
				<Sidebar.GroupContent>
					<Sidebar.Menu class="px-2">
						{#each db.state.projectConnections as connection (connection.id)}
							<ContextMenu.Root>
								<ContextMenu.Trigger class="w-full">
									<Sidebar.MenuItem>
										<Sidebar.MenuButton
											class={[
												"flex items-center gap-2 cursor-pointer",
												db.state.activeConnectionId === connection.id && "bg-sidebar-accent"
											]}
											onclick={() => handleConnectionClick(connection)}
										>
												<span class="flex size-2 items-center justify-center shrink-0">
												{#if db.connections.connectingIds.has(connection.id)}
													<LoaderIcon class="size-3 animate-spin text-muted-foreground" />
												{:else}
													<span
														class={[
															"size-2 rounded-full",
															(connection.providerConnectionId) ? "bg-green-500" : "bg-gray-400"
														]}
													></span>
												{/if}
											</span>
											<span class="flex-1 truncate text-sm">{connection.name}</span>
											{#if db.state.activeProjectHasGit}
												<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															type="button"
															class="shrink-0 cursor-pointer"
															onclick={(e) => { e.stopPropagation(); db.connections.toggleLocalOnly(connection.id); }}
														>
															<GitBranchIcon class={["size-3!", connection.isLocalOnly ? "text-muted-foreground/40" : "text-green-500"]} />
														</button>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content>
													{connection.isLocalOnly ? m.connection_share() : m.connection_mark_local_only()}
												</Tooltip.Content>
											</Tooltip.Root>
											{/if}
											{#if getConnectionLabels(connection).length > 0}
												<Tooltip.Root>
													<Tooltip.Trigger class="flex items-center">
														{#each getConnectionLabels(connection) as label, i (label.id)}
															<span
																class="size-2.5 rounded-full shrink-0 ring-1 ring-sidebar-background"
																style="background-color: {label.color}; {i > 0 ? 'margin-left: -4px;' : ''}"
															></span>
														{/each}
													</Tooltip.Trigger>
													<Tooltip.Content side="right">
														<div class="flex flex-col gap-1">
															{#each getConnectionLabels(connection) as label (label.id)}
																<div class="flex items-center gap-1.5 text-xs">
																	<span
																		class="size-2 rounded-full"
																		style="background-color: {label.color};"
																	></span>
																	{label.name}
																</div>
															{/each}
														</div>
													</Tooltip.Content>
												</Tooltip.Root>
											{/if}
										</Sidebar.MenuButton>
									</Sidebar.MenuItem>
								</ContextMenu.Trigger>
								<ContextMenu.Content class="w-48">
									{#if connection.providerConnectionId}
										<ContextMenu.Item onclick={() => db.connections.toggle(connection.id)}>
											<UnplugIcon class="size-4 me-2" />
											{m.sidebar_connection_disconnect()}
										</ContextMenu.Item>
										<ContextMenu.Separator />
										<ContextMenu.Item onclick={() => {
											db.connections.setActive(connection.id);
											db.statisticsTabs.add();
										}}>
											<BarChart3Icon class="size-4 me-2" />
											{m.sidebar_database_statistics()}
										</ContextMenu.Item>
										<ContextMenu.Item onclick={() => {
											db.connections.setActive(connection.id);
											db.erdTabs.add();
										}}>
											<NetworkIcon class="size-4 me-2" />
											{m.sidebar_erd_diagram()}
										</ContextMenu.Item>
										<ContextMenu.Item onclick={() => {
											db.connections.setActive(connection.id);
											db.workflowTabs.add();
										}}>
											<WorkflowIcon class="size-4 me-2" />
											{m.sidebar_workflows()}
										</ContextMenu.Item>
										<ContextMenu.Item onclick={async () => {
											db.connections.setActive(connection.id);
											const dashboard = await db.dashboards.createDashboard("New Dashboard");
											if (dashboard) {
												db.dashboardTabs.add(dashboard.id, dashboard.name);
											}
										}}>
											<LayoutDashboardIcon class="size-4 me-2" />
											Dashboards
										</ContextMenu.Item>
									{:else}
										<ContextMenu.Item onclick={() => handleConnectionClick(connection)}>
											<PlugIcon class="size-4 me-2" />
											{m.sidebar_connection_connect()}
										</ContextMenu.Item>
									{/if}
									<ContextMenu.Separator />
									<ContextMenu.Item onclick={() => void db.connectionTabs.open(connection, "edit")}>
										<PencilIcon class="size-4 me-2" />
										{m.sidebar_connection_edit()}
									</ContextMenu.Item>
									<ContextMenu.Item onclick={() => openLabelsDialog(connection.id, connection.name)}>
										<TagIcon class="size-4 me-2" />
										{m.sidebar_connection_labels()}
									</ContextMenu.Item>
									{#if connection.sharedConnectionId}
										{@const sharedConn = db.state.allSharedConnections.find((c) => c.id === connection.sharedConnectionId)}
										{#if sharedConn}
											<ContextMenu.Item onclick={() => copyShareLink(sharedConn)}>
												<LinkIcon class="size-4 me-2" />
												{m.share_connection()}
											</ContextMenu.Item>
										{/if}
									{/if}
									{#if !(isDemo() && connection.id === "demo-connection")}
										<ContextMenu.Separator />
										<ContextMenu.Item
											class="text-destructive focus:text-destructive"
											onclick={() => confirmRemoveConnection(connection.id, connection.name)}
										>
											<Trash2Icon class="size-4 me-2" />
											{m.sidebar_connection_delete()}
										</ContextMenu.Item>
									{/if}
								</ContextMenu.Content>
							</ContextMenu.Root>
						{/each}
						{#if db.state.projectConnections.length === 0}
							<div class="text-center py-2 text-muted-foreground">
								<p class="text-xs">{m.sidebar_no_connection()}</p>
							</div>
						{/if}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</CollapsibleContent>
		</Collapsible>
	</Sidebar.Group>

	<!-- Schema/Queries/Dashboards tabs - show when project has connections -->
	{#if db.state.activeProjectId && db.state.projectConnections.length > 0}
		<Tabs bind:value={sidebarTab} class="w-full px-2">
			<TabsList class="w-full justify-start rounded-none h-10 bg-transparent px-2">
				{#if hasActiveConnection}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<TabsTrigger {...props} value="schema" class="text-xs data-[state=active]:bg-background">
								<DatabaseIcon class="size-3" />
								{#if sidebarTab === "schema"}
									{m.sidebar_tab_schema()}
								{/if}
							</TabsTrigger>
						{/snippet}
					</Tooltip.Trigger>
					{#if sidebarTab !== "schema"}
						<Tooltip.Content>{m.sidebar_tab_schema()}</Tooltip.Content>
					{/if}
				</Tooltip.Root>
				{/if}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<TabsTrigger {...props} value="queries" class="text-xs data-[state=active]:bg-background">
								<FileTextIcon class="size-3" />
								{#if sidebarTab === "queries"}
									{m.sidebar_tab_queries()}
								{/if}
							</TabsTrigger>
						{/snippet}
					</Tooltip.Trigger>
					{#if sidebarTab !== "queries"}
						<Tooltip.Content>{m.sidebar_tab_queries()}</Tooltip.Content>
					{/if}
				</Tooltip.Root>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<TabsTrigger {...props} value="dashboards" class="text-xs data-[state=active]:bg-background">
								<LayoutDashboardIcon class="size-3" />
								{#if sidebarTab === "dashboards"}
									Dashboards
								{/if}
							</TabsTrigger>
						{/snippet}
					</Tooltip.Trigger>
					{#if sidebarTab !== "dashboards"}
						<Tooltip.Content>Dashboards</Tooltip.Content>
					{/if}
				</Tooltip.Root>
			</TabsList>
		</Tabs>
	{/if}
</Sidebar.Header>

<!-- Content -->
<Sidebar.Content>
	{#if db.state.activeConnectionId && db.state.activeConnection && (db.state.activeConnection.providerConnectionId)}
		<!-- Schema Tab Panel (requires active connection) -->
		<div
			class={["flex flex-col", sidebarTab !== "schema" && "hidden"]}
			aria-hidden={sidebarTab !== "schema"}
			inert={sidebarTab !== "schema" ? true : undefined}
		>
			<div class="px-4 py-2">
				<div class="flex items-center gap-1">
					<div class="relative flex-1">
						<SearchIcon class="absolute start-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
						<Input
							bind:value={schemaSearchQuery}
							placeholder={m.sidebar_search_tables()}
							class="ps-8 h-8 text-sm"
						/>
					</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon" class="size-8 shrink-0" onclick={handleRefreshSchema} disabled={isRefreshingSchema}>
									<RefreshCwIcon class={["size-4", isRefreshingSchema && "animate-spin"]} />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>{m.sidebar_refresh_schema()}</Tooltip.Content>
					</Tooltip.Root>
				</div>
			</div>
			<Sidebar.Group>
				<Sidebar.GroupContent class="px-2">
					<Sidebar.Menu>
						{#each [...tablesBySchema.entries()] as [schemaName, tables] (schemaName)}
							<Collapsible open={expandedSchemas.has(schemaName)} onOpenChange={() => toggleSchema(schemaName)}>
								<Sidebar.MenuItem>
									<CollapsibleTrigger>
										{#snippet child({ props })}
											<Sidebar.MenuButton {...props} class="pr-1">
												<ChevronRightIcon class={["size-4 transition-transform", expandedSchemas.has(schemaName) && "rotate-90"]} />
												<FolderIcon class="size-4" />
												<span class="flex-1">{schemaName}</span>
												<Badge variant="secondary" class="text-xs">{tables.length}</Badge>
											</Sidebar.MenuButton>
										{/snippet}
									</CollapsibleTrigger>
									<CollapsibleContent class="flex">
										<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
											{#each tables as table (table.name)}
												<Sidebar.MenuItem class="group/table-row flex">
													<Sidebar.MenuButton onclick={() => handleTableClick(table)}>
														<TableIcon class="size-4" />
														<span class="flex-1">{table.name}</span>
													<DropdownMenu.Root>
														<DropdownMenu.Trigger>
															{#snippet child({ props })}
																<button
																	{...props}
																	class="end-0 top-1.5 flex size-5 items-center justify-center rounded-md text-sidebar-foreground opacity-0 ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:outline-hidden group-hover/table-row:opacity-100 data-[state=open]:opacity-100"
																>
																	<MoreHorizontalIcon class="size-4" />
																</button>
															{/snippet}
														</DropdownMenu.Trigger>
														<DropdownMenu.Content align="end">
															{#if db.state.activeView === 'workflow' && db.state.activeWorkflowTabId}
																<DropdownMenu.Item onclick={() => db.workflow.addTableNode(table)}>
																	<LayoutGridIcon class="size-4 me-2" />
																	{m.sidebar_add_to_workflow()}
																</DropdownMenu.Item>
															{:else}
																<Tooltip.Root>
																	<Tooltip.Trigger class="w-full">
																		<DropdownMenu.Item disabled class="w-full">
																			<LayoutGridIcon class="size-4 me-2" />
																			{m.sidebar_add_to_workflow()}
																		</DropdownMenu.Item>
																	</Tooltip.Trigger>
																	<Tooltip.Content side="right">
																		{m.sidebar_open_workflow_hint()}
																	</Tooltip.Content>
																</Tooltip.Root>
															{/if}
														</DropdownMenu.Content>
													</DropdownMenu.Root>
													</Sidebar.MenuButton>
												</Sidebar.MenuItem>
											{/each}
										</Sidebar.Menu>
									</CollapsibleContent>
								</Sidebar.MenuItem>
							</Collapsible>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</div>
	{/if}

	{#if db.state.activeProjectId && db.state.projectConnections.length > 0}
		<!-- Queries Tab Panel -->
		<div
			class={["flex flex-col", sidebarTab !== "queries" && "hidden"]}
			aria-hidden={sidebarTab !== "queries"}
			inert={sidebarTab !== "queries" ? true : undefined}
		>
			<div class="px-4 py-2 flex">
				<div class="flex items-center gap-1">
					<div class="relative">
						<SearchIcon class="absolute start-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
						<Input
							bind:value={searchQuery}
							placeholder={m.sidebar_search_queries()}
							class="ps-8 h-8 text-sm"
						/>
					</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button {...props}
									variant="ghost"
									size="icon"
									class="size-8 shrink-0"
									onclick={() => {
										db.queryTabs.add();
										db.ui.setActiveView("query");
									}}
								>
									<PlusIcon class="size-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>{m.sidebar_new_query()}</Tooltip.Content>
					</Tooltip.Root>
				</div>
			</div>

			<Sidebar.Group>
				<Sidebar.GroupContent class="px-2">
					<Sidebar.Menu>
						<!-- Starred folder -->
						<Collapsible bind:open={starredExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", starredExpanded && "rotate-90"]} />
											<StarIcon class="size-4" />
											<span class="flex-1">{m.sidebar_starred()}</span>
											<Badge variant="secondary" class="text-xs">{totalStarredCount}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each starredSharedQueries as item (`starred-shared:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => handleQueryClick(item)}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<FileTextIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															aria-label={m.history_delete_saved()}
															onclick={(e) => {
																e.stopPropagation();
																queryToDelete = { id: item.id, name: item.name, type: "shared" };
																showDeleteQueryDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class={["size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 text-yellow-500"]}
															aria-label={m.sidebar_unstar_query()}
															onclick={(e) => {
																e.stopPropagation();
																db.savedQueries.toggleQueryStarred(item.id);
															}}
														>
															<StarIcon class="fill-current" />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-green-500 hover:text-muted-foreground transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleUnshareQuery(item.id); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_mark_local_only()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													{#if item.updatedAt}
														<p class="text-xs text-muted-foreground w-full text-start">
															{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
														</p>
													{/if}
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#each starredSavedQueries as item (`starred-saved:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => db.queryTabs.loadQuery(item.id, () => db.ui.setActiveView("query"))}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<BookmarkIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															aria-label={m.history_delete_saved()}
															onclick={(e) => {
																e.stopPropagation();
																queryToDelete = { id: item.id, name: item.name, type: "saved" };
																showDeleteQueryDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class={["size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 text-yellow-500"]}
															aria-label={m.sidebar_unstar_query()}
															onclick={(e) => {
																e.stopPropagation();
																db.savedQueries.toggleQueryStarred(item.id);
															}}
														>
															<StarIcon class="fill-current" />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-muted-foreground/40 hover:text-green-500 transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleShareQuery(item); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_share()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													<p class="text-xs text-muted-foreground w-full text-start">
														{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
													</p>
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#if totalStarredCount === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_starred()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>

						<!-- Local folder (non-shared, non-starred saved queries) -->
						<Collapsible bind:open={localExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", localExpanded && "rotate-90"]} />
											<BookmarkIcon class="size-4" />
											<span class="flex-1">{m.sidebar_local()}</span>
											<Badge variant="secondary" class="text-xs">{localQueries.length}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each localQueries as item (`local:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => db.queryTabs.loadQuery(item.id, () => db.ui.setActiveView("query"))}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<BookmarkIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															aria-label={m.history_delete_saved()}
															onclick={(e) => {
																e.stopPropagation();
																queryToDelete = { id: item.id, name: item.name, type: "saved" };
																showDeleteQueryDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity"
															aria-label={m.sidebar_star_query()}
															onclick={(e) => {
																e.stopPropagation();
																db.savedQueries.toggleQueryStarred(item.id);
															}}
														>
															<StarIcon />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-muted-foreground/40 hover:text-green-500 transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleShareQuery(item); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_share()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													<p class="text-xs text-muted-foreground w-full text-start">
														{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
													</p>
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#if localQueries.length === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_local()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>

						<!-- Shared folder (shared, non-starred queries) -->
						{#if db.state.activeProjectHasGit}
						<Collapsible bind:open={sharedExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", sharedExpanded && "rotate-90"]} />
											<GitBranchIcon class="size-4" />
											<span class="flex-1">{m.sidebar_shared()}</span>
											<Badge variant="secondary" class="text-xs">{nonStarredSharedQueries.length}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each nonStarredSharedQueries as item (`shared:${item.id}`)}
											<Sidebar.MenuItem>
												<ContextMenu.Root>
													<ContextMenu.Trigger>
														<Sidebar.MenuButton
															class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
															onclick={() => handleQueryClick(item)}
														>
															<div class="flex items-center w-full gap-2">
																<div class="flex items-center gap-2 flex-1 min-w-0">
																	<FileTextIcon class="size-3 text-primary shrink-0" />
																	<span class="text-sm font-medium truncate">{item.name}</span>
																</div>
																<Button
																	size="icon"
																	variant="ghost"
																	class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
																	aria-label={m.history_delete_saved()}
																	onclick={(e) => {
																		e.stopPropagation();
																		queryToDelete = { id: item.id, name: item.name, type: "shared" };
																		showDeleteQueryDialog = true;
																	}}
																>
																	<Trash2Icon />
																</Button>
																<Button
																	size="icon"
																	variant="ghost"
																	class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity"
																	aria-label={m.sidebar_star_query()}
																	onclick={(e) => {
																		e.stopPropagation();
																		db.savedQueries.toggleQueryStarred(item.id);
																	}}
																>
																	<StarIcon />
																</Button>
																<Tooltip.Root>
																	<Tooltip.Trigger>
																		{#snippet child({ props })}
																			<button
																				{...props}
																				class="shrink-0 cursor-pointer text-green-500 hover:text-muted-foreground transition-colors"
																				onclick={(e) => { e.stopPropagation(); handleUnshareQuery(item.id); }}
																			>
																				<GitBranchIcon class="size-3!" />
																			</button>
																		{/snippet}
																	</Tooltip.Trigger>
																	<Tooltip.Content>{m.connection_mark_local_only()}</Tooltip.Content>
																</Tooltip.Root>
															</div>
															{#if item.updatedAt}
																<p class="text-xs text-muted-foreground w-full text-start">
																	{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
																</p>
															{/if}
														</Sidebar.MenuButton>
													</ContextMenu.Trigger>
													<ContextMenu.Content class="w-44">
														<ContextMenu.Item onclick={() => copyShareLink(item)}>
															<LinkIcon class="size-4 me-2" />
															{m.share_query()}
														</ContextMenu.Item>
														<ContextMenu.Separator />
														<ContextMenu.Item onclick={() => handleUnshareQuery(item.id)}>
															<GitBranchIcon class="size-4 me-2" />
															{m.connection_mark_local_only()}
														</ContextMenu.Item>
														<ContextMenu.Item class="text-destructive" onclick={() => { queryToDelete = { id: item.id, name: item.name, type: "shared" }; showDeleteQueryDialog = true; }}>
															<Trash2Icon class="size-4 me-2" />
															{m.history_delete_saved()}
														</ContextMenu.Item>
													</ContextMenu.Content>
												</ContextMenu.Root>
											</Sidebar.MenuItem>
										{/each}
										{#if nonStarredSharedQueries.length === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												{#if !db.state.activeProjectHasGit}
													<button
														class="text-xs text-primary hover:underline cursor-pointer"
														onclick={() => { db.settingsTabs.open("project"); }}
													>
														{m.sidebar_share_queries()}
													</button>
												{:else}
													<p class="text-xs">{m.sidebar_no_shared()}</p>
												{/if}
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>
						{/if}

						<!-- History folder (per-connection) -->
						{#if db.state.activeConnectionId}
						<Collapsible bind:open={historyExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", historyExpanded && "rotate-90"]} />
											<HistoryIcon class="size-4" />
											<span class="flex-1">{m.sidebar_history()}</span>
											<Badge variant="secondary" class="text-xs">{filteredHistory.length}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each filteredHistory as item (item.id)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group pr-1"
													onclick={() => db.queryTabs.loadFromHistory(item.id, () => db.ui.setActiveView("query"))}
												>
													<div class="flex items-center justify-between w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<ClockIcon class="size-3 text-muted-foreground shrink-0" />
															<span class="text-xs text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
														</div>
														<Badge variant="secondary" class="text-xs shrink-0 tabular-nums">{item.executionTime}ms</Badge>
													</div>
													<p class="text-xs font-mono line-clamp-2 text-muted-foreground w-full text-left">
														{item.query}
													</p>
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#if filteredHistory.length === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_history()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>
						{/if}

					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</div>

		<!-- Dashboards Tab Panel -->
		<div
			class={["flex flex-col", sidebarTab !== "dashboards" && "hidden"]}
			aria-hidden={sidebarTab !== "dashboards"}
			inert={sidebarTab !== "dashboards" ? true : undefined}
		>
			<div class="px-4 py-2 flex">
			    <div class="flex items-center gap-1">
    				<div class="relative">
    					<SearchIcon class="absolute start-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
    					<Input
    						bind:value={dashboardSearchQuery}
    						placeholder={m.sidebar_search_dashboards()}
    						class="ps-8 h-8 text-sm"
    					/>
    				</div>
                    <Tooltip.Root>
                        <Tooltip.Trigger>
                            {#snippet child({ props })}
                                <Button {...props}
                   					variant="ghost"
                   					size="icon"
                   					class="size-8 shrink-0"
                   					onclick={async () => {
                  						const dashboard = await db.dashboards.createDashboard("New Dashboard");
                  						if (dashboard) {
                 							db.dashboardTabs.add(dashboard.id, dashboard.name);
                  						}
                   					}}
                				>
                   					<PlusIcon class="size-4" />
                				</Button>
                            {/snippet}
                        </Tooltip.Trigger>
                        <Tooltip.Content>{m.sidebar_new_dashboard()}</Tooltip.Content>
                    </Tooltip.Root>
    				
    			</div>
			</div>
			<Sidebar.Group>
				<Sidebar.GroupContent class="px-2">
					<Sidebar.Menu>
						<!-- Starred folder -->
						<Collapsible bind:open={dashboardStarredExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", dashboardStarredExpanded && "rotate-90"]} />
											<StarIcon class="size-4" />
											<span class="flex-1">{m.sidebar_starred()}</span>
											<Badge variant="secondary" class="text-xs">{totalStarredDashboardCount}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each starredSharedDashboards as item (`db-starred-shared:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => handleSharedDashboardClick(item)}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<LayoutDashboardIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															onclick={(e) => {
																e.stopPropagation();
																dashboardToDelete = { id: item.id, name: item.name, type: "shared" };
																showDeleteDashboardDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class={["size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 text-yellow-500"]}
															onclick={(e) => {
																e.stopPropagation();
																db.dashboards.toggleDashboardStarred(item.id);
															}}
														>
															<StarIcon class="fill-current" />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-green-500 hover:text-muted-foreground transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleUnshareDashboard(item.id); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_mark_local_only()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													{#if item.updatedAt}
														<p class="text-xs text-muted-foreground w-full text-start">
															{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
														</p>
													{/if}
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#each starredLocalDashboards as item (`db-starred-local:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => db.dashboardTabs.add(item.id, item.name)}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<LayoutDashboardIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															onclick={(e) => {
																e.stopPropagation();
																dashboardToDelete = { id: item.id, name: item.name, type: "local" };
																showDeleteDashboardDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class={["size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 text-yellow-500"]}
															onclick={(e) => {
																e.stopPropagation();
																db.dashboards.toggleDashboardStarred(item.id);
															}}
														>
															<StarIcon class="fill-current" />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-muted-foreground/40 hover:text-green-500 transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleShareDashboard(item); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_share()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													<p class="text-xs text-muted-foreground w-full text-start">
														{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
													</p>
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#if totalStarredDashboardCount === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_starred_dashboards()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>

						<!-- Local folder -->
						<Collapsible bind:open={dashboardLocalExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", dashboardLocalExpanded && "rotate-90"]} />
											<BookmarkIcon class="size-4" />
											<span class="flex-1">{m.sidebar_local()}</span>
											<Badge variant="secondary" class="text-xs">{nonStarredLocalDashboards.length}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each nonStarredLocalDashboards as item (`db-local:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
													onclick={() => db.dashboardTabs.add(item.id, item.name)}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<LayoutDashboardIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
															onclick={(e) => {
																e.stopPropagation();
																dashboardToDelete = { id: item.id, name: item.name, type: "local" };
																showDeleteDashboardDialog = true;
															}}
														>
															<Trash2Icon />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity"
															onclick={(e) => {
																e.stopPropagation();
																db.dashboards.toggleDashboardStarred(item.id);
															}}
														>
															<StarIcon />
														</Button>
														{#if db.state.activeProjectHasGit}
															<Tooltip.Root>
																<Tooltip.Trigger>
																	{#snippet child({ props })}
																		<button
																			{...props}
																			class="shrink-0 cursor-pointer text-muted-foreground/40 hover:text-green-500 transition-colors"
																			onclick={(e) => { e.stopPropagation(); handleShareDashboard(item); }}
																		>
																			<GitBranchIcon class="size-3!" />
																		</button>
																	{/snippet}
																</Tooltip.Trigger>
																<Tooltip.Content>{m.connection_share()}</Tooltip.Content>
															</Tooltip.Root>
														{/if}
													</div>
													<p class="text-xs text-muted-foreground w-full text-start">
														{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
													</p>
												</Sidebar.MenuButton>
											</Sidebar.MenuItem>
										{/each}
										{#if nonStarredLocalDashboards.length === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_local_dashboards()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>

						<!-- Shared folder -->
						{#if db.state.activeProjectHasGit}
						<Collapsible bind:open={dashboardSharedExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", dashboardSharedExpanded && "rotate-90"]} />
											<GitBranchIcon class="size-4" />
											<span class="flex-1">{m.sidebar_shared()}</span>
											<Badge variant="secondary" class="text-xs">{nonStarredSharedDashboards.length}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										{#each nonStarredSharedDashboards as item (`db-shared:${item.id}`)}
											<Sidebar.MenuItem>
												<ContextMenu.Root>
													<ContextMenu.Trigger>
														<Sidebar.MenuButton
															class="h-auto py-2 flex-col items-start gap-1 group/query overflow-hidden"
															onclick={() => handleSharedDashboardClick(item)}
														>
															<div class="flex items-center w-full gap-2">
																<div class="flex items-center gap-2 flex-1 min-w-0">
																	<LayoutDashboardIcon class="size-3 text-primary shrink-0" />
																	<span class="text-sm font-medium truncate">{item.name}</span>
																</div>
																<Button
																	size="icon"
																	variant="ghost"
																	class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity hover:text-destructive"
																	onclick={(e) => {
																		e.stopPropagation();
																		dashboardToDelete = { id: item.id, name: item.name, type: "shared" };
																		showDeleteDashboardDialog = true;
																	}}
																>
																	<Trash2Icon />
																</Button>
																<Button
																	size="icon"
																	variant="ghost"
																	class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover/query:opacity-100 transition-opacity"
																	onclick={(e) => {
																		e.stopPropagation();
																		db.dashboards.toggleDashboardStarred(item.id);
																	}}
																>
																	<StarIcon />
																</Button>
																<Tooltip.Root>
																	<Tooltip.Trigger>
																		{#snippet child({ props })}
																			<button
																				{...props}
																				class="shrink-0 cursor-pointer text-green-500 hover:text-muted-foreground transition-colors"
																				onclick={(e) => { e.stopPropagation(); handleUnshareDashboard(item.id); }}
																			>
																				<GitBranchIcon class="size-3!" />
																			</button>
																		{/snippet}
																	</Tooltip.Trigger>
																	<Tooltip.Content>{m.connection_mark_local_only()}</Tooltip.Content>
																</Tooltip.Root>
															</div>
															{#if item.updatedAt}
																<p class="text-xs text-muted-foreground w-full text-start">
																	{m.sidebar_updated({ time: formatRelativeTime(item.updatedAt) })}
																</p>
															{/if}
														</Sidebar.MenuButton>
													</ContextMenu.Trigger>
													<ContextMenu.Content class="w-44">
														<ContextMenu.Item onclick={() => copyShareLink(item, "dashboard")}>
															<LinkIcon class="size-4 me-2" />
															{m.share_dashboard()}
														</ContextMenu.Item>
														<ContextMenu.Separator />
														<ContextMenu.Item onclick={() => handleUnshareDashboard(item.id)}>
															<GitBranchIcon class="size-4 me-2" />
															{m.connection_mark_local_only()}
														</ContextMenu.Item>
														<ContextMenu.Item class="text-destructive" onclick={() => { dashboardToDelete = { id: item.id, name: item.name, type: "shared" }; showDeleteDashboardDialog = true; }}>
															<Trash2Icon class="size-4 me-2" />
															{m.history_delete_saved()}
														</ContextMenu.Item>
													</ContextMenu.Content>
												</ContextMenu.Root>
											</Sidebar.MenuItem>
										{/each}
										{#if nonStarredSharedDashboards.length === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												{#if !db.state.activeProjectHasGit}
													<button
														class="text-xs text-primary hover:underline cursor-pointer"
														onclick={() => { db.settingsTabs.open("project"); }}
													>
														{m.sidebar_share_dashboards()}
													</button>
												{:else}
													<p class="text-xs">{m.sidebar_no_shared_dashboards()}</p>
												{/if}
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>
						{/if}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</div>
	{/if}
</Sidebar.Content>

<!-- Footer -->
<Sidebar.Footer class="p-4">
	<div class="text-xs text-muted-foreground flex justify-between">
		<span>
			{#if sidebarTab === "schema" && db.state.activeConnection}
				{m.sidebar_tables_count({ count: db.state.activeSchema.length })}
			{:else if sidebarTab === "dashboards"}
				{@const total = db.state.projectDashboards.length}
				{total} dashboard{total !== 1 ? 's' : ''}
			{:else if sidebarTab === "queries"}
				{m.sidebar_queries_stats({ executed: db.state.activeConnectionQueryHistory.length, saved: db.state.projectQueries.length })}
			{:else}
				{m.sidebar_no_connection_footer()}
			{/if}
		</span>
		{#if isDemo()}
			<Badge variant="secondary" class="text-xs">Demo</Badge>
		{:else if version}
			<span>v{version}</span>
		{/if}
	</div>
</Sidebar.Footer>

<!-- Delete Connection Dialog -->
<DeleteConfirmDialog
	bind:open={showRemoveDialog}
	title={m.header_delete_dialog_title()}
	description={m.header_delete_dialog_description({ name: connectionToRemoveName })}
	cancelText={m.header_button_cancel()}
	confirmText={m.header_button_remove()}
	onconfirm={handleRemoveConnection}
/>

<!-- Labels Dialog -->
<Dialog.Root bind:open={showLabelsDialog}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.labels_dialog_title({ name: connectionToEditLabelsName })}</Dialog.Title>
		</Dialog.Header>
		<div class="py-4">
			{#if connectionToEditLabels}
				<ConnectionLabelPicker connectionId={connectionToEditLabels} />
			{/if}
		</div>
		<Dialog.Footer>
			<Button onclick={() => showLabelsDialog = false}>
				{m.labels_done()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Query Confirmation Dialog -->
<DeleteConfirmDialog
	bind:open={showDeleteQueryDialog}
	title={m.query_delete_title()}
	description={m.query_delete_description({ name: queryToDelete?.name ?? "" })}
	cancelText={m.theme_delete_cancel()}
	confirmText={m.theme_delete_confirm()}
	onconfirm={confirmDeleteQuery}
/>

<!-- Delete Dashboard Confirmation Dialog -->
<DeleteConfirmDialog
	bind:open={showDeleteDashboardDialog}
	title={m.dashboard_delete_title()}
	description={m.dashboard_delete_description({ name: dashboardToDelete?.name ?? "" })}
	cancelText={m.theme_delete_cancel()}
	confirmText={m.theme_delete_confirm()}
	onconfirm={confirmDeleteDashboard}
/>
