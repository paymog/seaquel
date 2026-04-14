<script lang="ts">
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Badge } from "$lib/components/ui/badge";
	import { m } from "$lib/paraglide/messages.js";
	import { isDemo } from "$lib/features";
	import { buildDeepLinkUrl } from "$lib/services/deep-link";
	import { toast } from "svelte-sonner";
	import { errorToast } from "$lib/utils/toast";
	import { Connections, TabNav, SchemaTab, QueriesTab, DashboardsTab } from "./sidebar/manage/index.js";

	interface Props {
		version?: string;
	}

	let { version = "" }: Props = $props();

	const db = useDatabase();

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

	const copyShareLink = async (resource: { repoId?: string; filePath?: string; name?: string; folder?: string }, resourceType: "query" | "dashboard" | "connection" = "query") => {
		const repoId = resource.repoId ?? db.state.activeRepoId;
		if (!repoId) {
			errorToast("No repository configured");
			return;
		}
		const repo = db.state.sharedRepos.find((r) => r.id === repoId);
		if (!repo || !repo.remoteUrl) {
			errorToast("This repository has no remote URL configured");
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
			errorToast("Cannot generate share link");
			return;
		}
		const url = buildDeepLinkUrl(repo.remoteUrl, repo.branch, filePath);
		await navigator.clipboard.writeText(url);
		toast.success("Link copied to clipboard");
	};
</script>

<!-- Header: Connections section -->
<Sidebar.Header class="p-0 py-1">
	<Connections oncopyShareLink={copyShareLink} />

	<!-- Schema/Queries/Dashboards tabs - show when project has connections -->
	{#if db.state.activeProjectId && db.state.projectConnections.length > 0}
		<TabNav bind:value={sidebarTab} {hasActiveConnection} />
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
			<SchemaTab />
		</div>
	{/if}

	{#if db.state.activeProjectId && db.state.projectConnections.length > 0}
		<!-- Queries Tab Panel -->
		<div
			class={["flex flex-col", sidebarTab !== "queries" && "hidden"]}
			aria-hidden={sidebarTab !== "queries"}
			inert={sidebarTab !== "queries" ? true : undefined}
		>
			<QueriesTab oncopyShareLink={copyShareLink} />
		</div>

		<!-- Dashboards Tab Panel -->
		<div
			class={["flex flex-col", sidebarTab !== "dashboards" && "hidden"]}
			aria-hidden={sidebarTab !== "dashboards"}
			inert={sidebarTab !== "dashboards" ? true : undefined}
		>
			<DashboardsTab oncopyShareLink={copyShareLink} />
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
