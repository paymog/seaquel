<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { Button } from "$lib/components/ui/button";
	import { errorToast } from "$lib/utils/toast";
	import { isTauri } from "$lib/utils/environment";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { getDataDir } from "$lib/api/tauri";
	import { openLogViewer } from "$lib/utils/log-viewer-window";
	import DatabaseIcon from "@lucide/svelte/icons/database";
	import FileTextIcon from "@lucide/svelte/icons/file-text";
	import type { SettingsTab } from "$lib/types";

	interface Props {
		tab: SettingsTab;
	}

	let { tab }: Props = $props();

	const db = useDatabase();

	let appVersion = $state<string>("");
	let configPath = $state<string>("");
	let dataPath = $state<string>("");
	let logPath = $state<string>("");
	let isConnectingInternal = $state(false);

	onMount(() => {
		if (isTauri()) loadAppInfo();
	});

	async function loadAppInfo() {
		try {
			// platform-specific: app/path APIs only available in Tauri runtime
			const { getVersion } = await import("@tauri-apps/api/app");
			const { appConfigDir, appDataDir, appLogDir } = await import("@tauri-apps/api/path");
			appVersion = await getVersion();
			configPath = await appConfigDir();
			dataPath = await appDataDir();
			logPath = await appLogDir();
		} catch (error) {
			console.error("Failed to load app info:", error);
		}
	}

	async function connectToInternalDatabase() {
		isConnectingInternal = true;
		const tabId = tab.id;
		try {
			const existing = db.state.projects.find((p) => p.name === "Seaquel Internal");
			if (existing) {
				await db.projects.setActive(existing.id);
				const internalConnection = db.state.connections.find(
					(c) => c.projectId === existing.id
				);
				if (internalConnection && !internalConnection.providerConnectionId) {
					await db.connections.autoReconnect(internalConnection.id);
				} else if (internalConnection) {
					db.connections.setActive(internalConnection.id);
				}
			} else {
				let dbPath: string;
				if (isTauri()) {
					const dataDir = await getDataDir();
					dbPath = `${dataDir}/seaquel.db`;
				} else {
					dbPath = "seaquel.db";
				}
				const project = await db.projects.add("Seaquel Internal");
				await db.connections.add({
					name: "Internal Database",
					type: "sqlite",
					host: "",
					port: 0,
					databaseName: dbPath,
					username: "",
					password: "",
					connectionString: `sqlite://${dbPath}`,
					projectId: project.id,
				});
			}
			db.settingsTabs.remove(tabId);
		} catch (error) {
			errorToast(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			isConnectingInternal = false;
		}
	}
</script>

<div class="space-y-6" data-section="app-info">
	<div>
		<h2 class="text-lg font-medium">{m.settings_app_info()}</h2>
		<p class="text-sm text-muted-foreground mt-1">
			Information about your Seaquel installation
		</p>
	</div>

	<div class="space-y-4">
		<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
			<span class="text-muted-foreground">{m.settings_version()}</span>
			<span class="font-mono">{appVersion || "..."}</span>
		</div>
		<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
			<span class="text-muted-foreground">{m.settings_config_dir()}</span>
			<span class="font-mono text-xs break-all select-all">{configPath || "..."}</span>
		</div>
		<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
			<span class="text-muted-foreground">{m.settings_data_dir()}</span>
			<span class="font-mono text-xs break-all select-all">{dataPath || "..."}</span>
		</div>
		<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
			<span class="text-muted-foreground">{m.settings_log_dir()}</span>
			<span class="font-mono text-xs break-all select-all">{logPath || "..."}</span>
		</div>
	</div>

	<div class="flex gap-2">
		<Button
			variant="outline"
			size="sm"
			onclick={connectToInternalDatabase}
			disabled={isConnectingInternal}
		>
			<DatabaseIcon class="size-4 mr-1" />
			Connect to Internal Database
		</Button>
		<Button
			variant="outline"
			size="sm"
			onclick={openLogViewer}
		>
			<FileTextIcon class="size-4 mr-1" />
			{m.settings_view_logs()}
		</Button>
	</div>
</div>
