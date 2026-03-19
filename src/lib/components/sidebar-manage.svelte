<script lang="ts">
	import { SvelteSet } from "svelte/reactivity";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { formatRelativeTime } from "$lib/utils.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
	import { TableIcon, ChevronRightIcon, FolderIcon, HistoryIcon, StarIcon, ClockIcon, BookmarkIcon, Trash2Icon, SearchIcon, DatabaseIcon, FileTextIcon, PlusIcon, PlugIcon, UnplugIcon, TagIcon, BarChart3Icon, NetworkIcon, LayoutGridIcon, MoreHorizontalIcon, GitBranchIcon, PencilIcon, RefreshCwIcon, LoaderIcon, LayoutDashboardIcon } from "@lucide/svelte";
	import type { SharedQuery } from "$lib/types";
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "$lib/components/ui/collapsible";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { m } from "$lib/paraglide/messages.js";
	import { isDemo, getFeatures } from "$lib/features";
	import ConnectionLabelPicker from "$lib/components/connection-label-picker.svelte";
	import { buildDeepLinkUrl } from "$lib/services/deep-link";
	import { LinkIcon } from "@lucide/svelte";
	import { toast } from "svelte-sonner";

	interface Props {
		version?: string;
	}

	let { version = "" }: Props = $props();

	const db = useDatabase();
	const features = getFeatures();

	let sidebarTab = $state<"schema" | "queries" | "dashboards">("schema");
	let connectionsExpanded = $state(true);
	let expandedSchemas = new SvelteSet<string>();
	let historyExpanded = $state(true);
	let savedExpanded = $state(true);
	let searchQuery = $state("");
	let schemaSearchQuery = $state("");
	let isRefreshingSchema = $state(false);

	// Remove connection confirmation dialog state
	let showRemoveDialog = $state(false);
	let connectionToRemove = $state<string | null>(null);
	let connectionToRemoveName = $state("");

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

	const filteredSharedQueries = $derived(
		db.state.activeRepoQueries.filter(
			(item) =>
				item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.query.toLowerCase().includes(searchQuery.toLowerCase()),
		),
	);

	// Shared query names to exclude from saved list (shared version takes precedence)
	const sharedQueryNames = $derived(
		new Set(db.state.activeRepoQueries.map((q) => q.name.toLowerCase())),
	);

	const filteredSavedQueries = $derived(
		db.state.activeConnectionSavedQueries.filter(
			(item) =>
				!sharedQueryNames.has(item.name.toLowerCase()) &&
				(item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.query.toLowerCase().includes(searchQuery.toLowerCase())),
		),
	);

	const totalSavedCount = $derived(filteredSavedQueries.length + filteredSharedQueries.length);

	const handleSharedQueryClick = (query: SharedQuery) => {
		db.queryTabs.loadSharedQuery(query.id, query.name, query.query, () => db.ui.setActiveView("query"));
	};

	const handleShareQuery = async (item: typeof db.state.activeConnectionSavedQueries[0]) => {
		try {
			await db.sharedQueries.shareQuery(item);
		} catch (error) {
			console.error("Failed to share query:", error);
		}
	};

	const handleUnshareQuery = async (queryId: string) => {
		try {
			// Save the query locally before removing from git (if not already saved)
			const sharedQuery = db.sharedQueries.getQuery(queryId);
			if (sharedQuery && db.state.activeConnectionId) {
				const savedQueries = db.state.savedQueriesByConnection[db.state.activeConnectionId] ?? [];
				const alreadySaved = savedQueries.some(
					(q) => q.name.toLowerCase() === sharedQuery.name.toLowerCase(),
				);
				if (!alreadySaved) {
					db.savedQueries.saveQuery(sharedQuery.name, sharedQuery.query, undefined, sharedQuery.parameters);
				}
			}
			await db.sharedQueries.unshareQuery(queryId);
		} catch (error) {
			console.error("Failed to unshare query:", error);
		}
	};

	const handleConnectionClick = async (connection: typeof db.state.connections[0]) => {
		// If connection has a database instance, just activate it
		if (connection.database || connection.mssqlConnectionId || connection.providerConnectionId) {
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

	const copyShareLink = async (query: SharedQuery) => {
		const repo = db.state.sharedRepos.find((r) => r.id === query.repoId);
		if (!repo || !repo.remoteUrl) {
			toast.error("This repository has no remote URL configured");
			return;
		}
		const url = buildDeepLinkUrl(repo.remoteUrl, query.filePath, repo.branch);
		await navigator.clipboard.writeText(url);
		toast.success("Link copied to clipboard");
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
															(connection.database || connection.mssqlConnectionId || connection.providerConnectionId) ? "bg-green-500" : "bg-gray-400"
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
									{#if connection.database || connection.mssqlConnectionId || connection.providerConnectionId}
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
											db.canvasTabs.add();
										}}>
											<LayoutGridIcon class="size-4 me-2" />
											{m.sidebar_canvas_workspace()}
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

	<!-- Schema/Queries tabs - only show when connected -->
	{#if db.state.activeConnectionId}
		<Tabs bind:value={sidebarTab} class="w-full px-2">
			<TabsList class="w-full justify-start rounded-none h-10 bg-transparent px-2">
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
	{#if db.state.activeConnectionId && db.state.activeConnection && (db.state.activeConnection.database || db.state.activeConnection.mssqlConnectionId || db.state.activeConnection.providerConnectionId)}
		<!-- Schema Tab Panel -->
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
				<Sidebar.GroupLabel>{db.state.activeConnection.name}</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each [...tablesBySchema.entries()] as [schemaName, tables] (schemaName)}
							<Collapsible open={expandedSchemas.has(schemaName)} onOpenChange={() => toggleSchema(schemaName)}>
								<Sidebar.MenuItem>
									<CollapsibleTrigger>
										{#snippet child({ props })}
											<Sidebar.MenuButton {...props}>
												<ChevronRightIcon class={["size-4 transition-transform", expandedSchemas.has(schemaName) && "rotate-90"]} />
												<FolderIcon class="size-4" />
												<span class="flex-1">{schemaName}</span>
												<Badge variant="secondary" class="text-xs">{tables.length}</Badge>
											</Sidebar.MenuButton>
										{/snippet}
									</CollapsibleTrigger>
									<CollapsibleContent>
										<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
											{#each tables as table (table.name)}
												<Sidebar.MenuItem class="group/table-row flex pr-2">
													<Sidebar.MenuButton onclick={() => handleTableClick(table)}>
														<TableIcon class="size-4" />
														<span class="flex-1">{table.name}</span>
													<DropdownMenu.Root>
														<DropdownMenu.Trigger>
															{#snippet child({ props })}
																<button
																	{...props}
																	class="TTTabsolute end-0 top-1.5 flex size-5 items-center justify-center rounded-md text-sidebar-foreground opacity-0 ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:outline-hidden group-hover/table-row:opacity-100 data-[state=open]:opacity-100"
																>
																	<MoreHorizontalIcon class="size-4" />
																</button>
															{/snippet}
														</DropdownMenu.Trigger>
														<DropdownMenu.Content align="end">
															{#if db.state.activeView === 'canvas' && db.state.activeCanvasTabId}
																<DropdownMenu.Item onclick={() => db.canvas.addTableNode(table)}>
																	<LayoutGridIcon class="size-4 me-2" />
																	{m.sidebar_add_to_canvas()}
																</DropdownMenu.Item>
															{:else}
																<Tooltip.Root>
																	<Tooltip.Trigger class="w-full">
																		<DropdownMenu.Item disabled class="w-full">
																			<LayoutGridIcon class="size-4 me-2" />
																			{m.sidebar_add_to_canvas()}
																		</DropdownMenu.Item>
																	</Tooltip.Trigger>
																	<Tooltip.Content side="right">
																		{m.sidebar_open_canvas_hint()}
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

		<!-- Queries Tab Panel -->
		<div
			class={["flex flex-col", sidebarTab !== "queries" && "hidden"]}
			aria-hidden={sidebarTab !== "queries"}
			inert={sidebarTab !== "queries" ? true : undefined}
		>
			<div class="px-4 py-2">
				<div class="relative">
					<SearchIcon class="absolute start-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
					<Input
						bind:value={searchQuery}
						placeholder={m.sidebar_search_queries()}
						class="ps-8 h-8 text-sm"
					/>
				</div>
			</div>

			<Sidebar.Group>
				<Sidebar.GroupContent class="px-2">
					<Sidebar.Menu>
						<!-- Saved folder (includes both local saved queries and shared queries) -->
						<Collapsible bind:open={savedExpanded}>
							<Sidebar.MenuItem>
								<CollapsibleTrigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton {...props} class="pr-1">
											<ChevronRightIcon class={["size-4 transition-transform", savedExpanded && "rotate-90"]} />
											<BookmarkIcon class="size-4" />
											<span class="flex-1">{m.sidebar_saved()}</span>
											<Badge variant="secondary" class="text-xs">{totalSavedCount}</Badge>
										</Sidebar.MenuButton>
									{/snippet}
								</CollapsibleTrigger>
								<CollapsibleContent class="flex">
									<Sidebar.Menu class="ms-4 border-s border-sidebar-border ps-2">
										<!-- Shared queries from git repo -->
										{#each filteredSharedQueries as item (`shared:${item.id}`)}
											<Sidebar.MenuItem>
												<ContextMenu.Root>
													<ContextMenu.Trigger>
														<Sidebar.MenuButton
															class="h-auto py-2 flex-col items-start gap-1 group overflow-hidden"
															onclick={() => handleSharedQueryClick(item)}
														>
															<div class="flex items-center w-full gap-2">
																<div class="flex items-center gap-2 flex-1 min-w-0">
																	<FileTextIcon class="size-3 text-primary shrink-0" />
																	<span class="text-sm font-medium truncate">{item.name}</span>
																</div>
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
														</Sidebar.MenuButton>
													</ContextMenu.Trigger>
													<ContextMenu.Content class="w-44">
														<ContextMenu.Item onclick={() => copyShareLink(item)}>
															<LinkIcon class="size-4 me-2" />
															Copy Link
														</ContextMenu.Item>
														<ContextMenu.Separator />
														<ContextMenu.Item onclick={() => handleUnshareQuery(item.id)}>
															<GitBranchIcon class="size-4 me-2" />
															{m.connection_mark_local_only()}
														</ContextMenu.Item>
													</ContextMenu.Content>
												</ContextMenu.Root>
											</Sidebar.MenuItem>
										{/each}
										<!-- Local saved queries -->
										{#each filteredSavedQueries as item (`saved:${item.id}`)}
											<Sidebar.MenuItem>
												<Sidebar.MenuButton
													class="h-auto py-2 flex-col items-start gap-1 group overflow-hidden"
													onclick={() => db.queryTabs.loadSaved(item.id)}
												>
													<div class="flex items-center w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<BookmarkIcon class="size-3 text-primary shrink-0" />
															<span class="text-sm font-medium truncate">{item.name}</span>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class="size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
															aria-label={m.history_delete_saved()}
															onclick={(e) => {
																e.stopPropagation();
																db.savedQueries.deleteSavedQuery(item.id);
															}}
														>
															<Trash2Icon />
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
										{#if totalSavedCount === 0}
											<div class="text-center py-4 text-muted-foreground px-2">
												<p class="text-xs">{m.sidebar_no_saved()}</p>
											</div>
										{/if}
									</Sidebar.Menu>
								</CollapsibleContent>
							</Sidebar.MenuItem>
						</Collapsible>

						<!-- History folder -->
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
													class="h-auto py-2 flex-col items-start gap-1 group"
													onclick={() => db.queryTabs.loadFromHistory(item.id)}
												>
													<div class="flex items-center justify-between w-full gap-2">
														<div class="flex items-center gap-2 flex-1 min-w-0">
															<ClockIcon class="size-3 text-muted-foreground shrink-0" />
															<span class="text-xs text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
															<Badge variant="secondary" class="text-xs">{item.executionTime}ms</Badge>
														</div>
														<Button
															size="icon"
															variant="ghost"
															class={[
																"size-5 shrink-0 [&_svg:not([class*='size-'])]:size-3",
																item.favorite && "text-yellow-500",
															]}
															aria-label={item.favorite ? m.history_remove_favorite() : m.history_add_favorite()}
															onclick={(e) => {
																e.stopPropagation();
																db.history.toggleQueryFavorite(item.id);
															}}
														>
															<StarIcon class={[item.favorite && "fill-current"]} />
														</Button>
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
			<Sidebar.Group>
				<Sidebar.GroupContent>
					<div class="px-4 py-2">
						<Button
							variant="outline"
							size="sm"
							class="w-full text-xs"
							onclick={async () => {
								const dashboard = await db.dashboards.createDashboard("New Dashboard");
								if (dashboard) {
									db.dashboardTabs.add(dashboard.id, dashboard.name);
								}
							}}
						>
							<PlusIcon class="size-3 me-1" />
							New Dashboard
						</Button>
					</div>
					<Sidebar.Menu>
						{#each db.state.activeConnectionDashboards as dashboard (dashboard.id)}
							<Sidebar.MenuItem>
								<ContextMenu.Root>
									<ContextMenu.Trigger>
										<Sidebar.MenuButton
											class="text-xs"
											onclick={() => {
												db.dashboardTabs.add(dashboard.id, dashboard.name);
											}}
										>
											<LayoutDashboardIcon class="size-3" />
											<span class="flex-1 truncate">{dashboard.name}</span>
											<Badge variant="secondary" class="text-xs px-1 py-0">
												{dashboard.widgets.length}
											</Badge>
										</Sidebar.MenuButton>
									</ContextMenu.Trigger>
									<ContextMenu.Content class="w-40">
										<ContextMenu.Item
											onclick={() => {
												const newName = prompt("Rename dashboard:", dashboard.name);
												if (newName?.trim()) {
													db.dashboards.renameDashboard(dashboard.id, newName.trim());
												}
											}}
										>
											<PencilIcon class="size-4 me-2" />
											Rename
										</ContextMenu.Item>
										<ContextMenu.Separator />
										<ContextMenu.Item
											class="text-destructive focus:text-destructive"
											onclick={() => {
												db.dashboards.deleteDashboard(dashboard.id);
												// Close any tabs for this dashboard
												const tabsToClose = db.state.dashboardTabs.filter(
													(t) => t.dashboardId === dashboard.id
												);
												for (const t of tabsToClose) {
													db.dashboardTabs.remove(t.id);
												}
											}}
										>
											<Trash2Icon class="size-4 me-2" />
											Delete
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Root>
							</Sidebar.MenuItem>
						{:else}
							<div class="px-4 py-6 text-center text-xs text-muted-foreground">
								No dashboards yet. Create one to get started.
							</div>
						{/each}
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
			{#if db.state.activeConnection}
				{#if sidebarTab === "schema"}
					{m.sidebar_tables_count({ count: db.state.activeSchema.length })}
				{:else if sidebarTab === "dashboards"}
					{db.state.activeConnectionDashboards.length} dashboard{db.state.activeConnectionDashboards.length !== 1 ? 's' : ''}
				{:else}
					{m.sidebar_queries_stats({ executed: db.state.activeConnectionQueryHistory.length, saved: db.state.activeConnectionSavedQueries.length })}
				{/if}
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
<Dialog.Root bind:open={showRemoveDialog}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.header_delete_dialog_title()}</Dialog.Title>
			<Dialog.Description>
				{m.header_delete_dialog_description({ name: connectionToRemoveName })}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => showRemoveDialog = false}>
				{m.header_button_cancel()}
			</Button>
			<Button variant="destructive" onclick={handleRemoveConnection}>
				{m.header_button_remove()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

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
