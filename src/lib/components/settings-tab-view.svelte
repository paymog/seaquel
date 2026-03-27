<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "$lib/components/ui/select";
	import { Button } from "$lib/components/ui/button";
	import {
		type SettingsSection,
		type SettingsGroup,
		type SettingsView,
		groupSections,
	} from "$lib/stores/settings-dialog.svelte.js";
	import { themeStore } from "$lib/stores/theme.svelte.js";
	import { getVersion } from "@tauri-apps/api/app";
	import { appConfigDir, appDataDir, appLogDir } from "@tauri-apps/api/path";
	import { setMode, resetMode, mode } from "mode-watcher";
	import { setTheme } from "@tauri-apps/api/app";
	import { toast } from "svelte-sonner";
	import { errorToast } from "$lib/utils/toast";
	import { open, save } from "@tauri-apps/plugin-dialog";
	import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
	import SettingsIcon from "@lucide/svelte/icons/settings";
	import PaletteIcon from "@lucide/svelte/icons/palette";
	import InfoIcon from "@lucide/svelte/icons/info";
	import SunMoonIcon from "@lucide/svelte/icons/sun-moon";
	import SwatchBookIcon from "@lucide/svelte/icons/swatch-book";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import UploadIcon from "@lucide/svelte/icons/upload";
	import CopyIcon from "@lucide/svelte/icons/copy";
	import DownloadIcon from "@lucide/svelte/icons/download";
	import TrashIcon from "@lucide/svelte/icons/trash-2";
	import CheckIcon from "@lucide/svelte/icons/check";
	import BlocksIcon from "@lucide/svelte/icons/blocks";
	import GraduationCapIcon from "@lucide/svelte/icons/graduation-cap";
	import KeyIcon from "@lucide/svelte/icons/key-round";
	import SparklesIcon from "@lucide/svelte/icons/sparkles";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import ShieldIcon from "@lucide/svelte/icons/shield";
	import HistoryIcon from "@lucide/svelte/icons/history";
	import ThemePreview from "./theme-preview.svelte";
	import { openThemeEditor } from "$lib/utils/theme-editor-window";
	import type { Theme } from "$lib/types/theme";
	import type { SettingsTab } from "$lib/types";
	import { Switch } from "$lib/components/ui/switch";
	import { onboardingStore } from "$lib/stores/onboarding.svelte.js";
	import { aiSettingsStore } from "$lib/stores/ai-settings.svelte.js";
	import { getDatabase } from "$lib/storage/db";
	import { appStateRepo } from "$lib/storage/repository";
	import { getKeyringService } from "$lib/services/keyring";
	import { licenseStore } from "$lib/stores/license.svelte.js";
	import { isTauri } from "$lib/utils/environment";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { getDataDir } from "$lib/api/tauri";
	import DatabaseIcon from "@lucide/svelte/icons/database";
	import FileTextIcon from "@lucide/svelte/icons/file-text";
	import { openLogViewer } from "$lib/utils/log-viewer-window";

	interface Props {
		tab: SettingsTab;
	}

	let { tab }: Props = $props();

	const db = useDatabase();

	// Local navigation state derived from tab's activeView
	const activeView = $derived((tab.activeView ?? "all") as SettingsView | "all");

	function setView(view: SettingsView | "all") {
		db.settingsTabs.setSettingsView(tab.id, view);
	}

	function isGroupView(): boolean {
		return (
			activeView === "all" ||
			activeView === "general" ||
			activeView === "appearance" ||
			activeView === "features" ||
			activeView === "ai"
		);
	}

	function getActiveGroup(): SettingsGroup | "all" {
		if (activeView === "all") return "all";
		if (
			activeView === "general" ||
			activeView === "appearance" ||
			activeView === "features" ||
			activeView === "ai"
		) {
			return activeView;
		}
		return (
			{
				"app-info": "general",
				license: "general",
				"query-history": "general",
				theme: "appearance",
				themes: "appearance",
				"ai-feature": "features",
				learn: "features",
				"ai-provider": "ai",
				"ai-privacy": "ai",
			} as Record<SettingsSection, SettingsGroup>
		)[activeView as SettingsSection];
	}

	// App info state
	let appVersion = $state<string>("");
	let configPath = $state<string>("");
	let dataPath = $state<string>("");
	let logPath = $state<string>("");

	// Query version limit
	let queryVersionLimit = $state<number>(100);

	// Dashboard version limit
	let dashboardVersionLimit = $state<number>(100);

	// Delete confirmation state
	let deleteDialogOpen = $state(false);
	let themeToDelete = $state<Theme | null>(null);

	// Provider delete confirmation state
	let deleteProviderDialogOpen = $state(false);
	let providerToDelete = $state<string | null>(null);

	// Load app info on mount
	onMount(async () => {
		loadAppInfo();
		const savedLimit = await appStateRepo.get(await getDatabase(), "query_version_limit");
		if (savedLimit) {
			const parsed = parseInt(savedLimit, 10);
			if (!isNaN(parsed)) queryVersionLimit = parsed;
		}
		const savedDashboardLimit = await appStateRepo.get(await getDatabase(), "dashboard_version_limit");
		if (savedDashboardLimit) {
			const parsed = parseInt(savedDashboardLimit, 10);
			if (!isNaN(parsed)) dashboardVersionLimit = parsed;
		}
	});

	async function loadAppInfo() {
		try {
			appVersion = await getVersion();
			configPath = await appConfigDir();
			dataPath = await appDataDir();
			logPath = await appLogDir();
		} catch (error) {
			console.error("Failed to load app info:", error);
		}
	}

	// Mode handling (light/dark/system)
	async function handleModeChange(value: string) {
		if (value === "system") {
			await setTheme(null);
			resetMode();
		} else {
			await setTheme(value as "light" | "dark");
			setMode(value as "light" | "dark");
		}
	}

	const currentMode = $derived(
		mode.current === "light" ? "light" : mode.current === "dark" ? "dark" : "system"
	);

	const modeLabel = $derived(
		currentMode === "light"
			? m.theme_light()
			: currentMode === "dark"
				? m.theme_dark()
				: m.theme_system()
	);

	// Theme selection
	function handleLightThemeChange(themeId: string) {
		themeStore.setLightTheme(themeId);
	}

	function handleDarkThemeChange(themeId: string) {
		themeStore.setDarkTheme(themeId);
	}

	// Theme actions
	function openCreateTheme() {
		openThemeEditor(null);
	}

	function openEditTheme(theme: Theme) {
		openThemeEditor(theme);
	}

	function duplicateTheme(theme: Theme) {
		const newTheme = themeStore.duplicateTheme(theme.id);
		if (newTheme) {
			toast.success(m.theme_duplicate_success());
		}
	}

	async function exportTheme(theme: Theme) {
		try {
			const json = themeStore.exportTheme(theme.id);
			const fileName = theme.name.toLowerCase().replace(/\s+/g, "-") + ".json";

			const filePath = await save({
				defaultPath: fileName,
				filters: [{ name: "JSON", extensions: ["json"] }],
			});

			if (filePath) {
				await writeTextFile(filePath, json);
				toast.success(m.theme_export_success());
			}
		} catch (error) {
			console.error("Failed to export theme:", error);
		}
	}

	function confirmDeleteTheme(theme: Theme) {
		themeToDelete = theme;
		deleteDialogOpen = true;
	}

	function deleteTheme() {
		if (themeToDelete) {
			themeStore.deleteTheme(themeToDelete.id);
			toast.success(m.theme_delete_success());
			themeToDelete = null;
			deleteDialogOpen = false;
		}
	}

	async function importTheme() {
		try {
			const filePath = await open({
				filters: [{ name: "JSON", extensions: ["json"] }],
				multiple: false,
			});

			if (filePath) {
				const content = await readTextFile(filePath as string);
				themeStore.importTheme(content);
				toast.success(m.theme_import_success());
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorToast(m.theme_import_error({ error: message }));
		}
	}

	// Navigation structure
	type NavSubItem = {
		id: SettingsSection;
		name: string;
		icon: typeof InfoIcon;
	};

	type NavGroup = {
		id: SettingsGroup;
		name: string;
		icon: typeof SettingsIcon;
		items: NavSubItem[];
	};

	const navGroups: NavGroup[] = $derived([
		{
			id: "general",
			name: m.settings_general(),
			icon: SettingsIcon,
			items: [
				{ id: "app-info", name: m.settings_app_info(), icon: InfoIcon },
				...(isTauri() ? [{ id: "license" as const, name: m.settings_license(), icon: KeyIcon }] : []),
				{ id: "query-history", name: m.settings_query_history(), icon: HistoryIcon },
			],
		},
		{
			id: "appearance",
			name: m.settings_appearance(),
			icon: PaletteIcon,
			items: [
				{ id: "theme", name: m.settings_theme(), icon: SunMoonIcon },
				{ id: "themes", name: m.settings_themes(), icon: SwatchBookIcon },
			],
		},
		{
			id: "features",
			name: m.settings_features(),
			icon: BlocksIcon,
			items: [],
		},
		{
			id: "ai",
			name: m.settings_ai(),
			icon: SparklesIcon,
			items: [
				{ id: "ai-provider", name: m.settings_ai_provider(), icon: SparklesIcon },
				{ id: "ai-privacy", name: m.settings_ai_privacy(), icon: ShieldIcon },
			],
		},
	]);

	// Find the active group for breadcrumb display
	const activeGroupObj = $derived(() => {
		const groupId = getActiveGroup();
		return navGroups.find((g) => g.id === groupId);
	});

	// Find the active section name (only when viewing a specific section)
	const activeSectionName = $derived(() => {
		if (isGroupView()) return null;
		for (const group of navGroups) {
			const item = group.items.find((item) => item.id === activeView);
			if (item) return item.name;
		}
		return null;
	});

	// Check if a section should be shown
	function shouldShowSection(sectionId: SettingsSection): boolean {
		// If viewing all, show everything
		if (activeView === "all") return true;
		// If viewing a specific section, only show that one
		if (activeView === sectionId) return true;
		// If viewing a group, show all sections in that group
		if (activeView === "general" || activeView === "appearance" || activeView === "features" || activeView === "ai") {
			return groupSections[activeView].includes(sectionId);
		}
		return false;
	}

	// Handle AI toggle
	async function handleAIToggle(checked: boolean) {
		const database = await getDatabase();
		await aiSettingsStore.setEnabled(database, checked);
		if (!checked && db.state.isAIOpen) {
			db.ui.toggleAI();
		}
	}

	// Handle Learn toggle
	function handleLearnToggle(checked: boolean) {
		onboardingStore.setLearnEnabled(checked);
		if (!checked && page.url.pathname.startsWith(resolve("/learn"))) {
			goto(resolve("/manage"));
		}
	}

	// Map section IDs to their parent group
	const sectionToGroup: Record<string, SettingsGroup> = {
		"app-info": "general",
		license: "general",
		theme: "appearance",
		themes: "appearance",
		"ai-feature": "features",
		learn: "features",
		"ai-provider": "ai",
		"ai-privacy": "ai",
		"query-history": "general",
	};

	// Get scroll-spy section only if it belongs to the current view's group
	function visibleInGroup(groupId: SettingsGroup): string | null {
		return visibleSectionId && sectionToGroup[visibleSectionId] === groupId ? visibleSectionId : null;
	}

	// Check if a menu item is active
	function isItemActive(itemId: SettingsSection): boolean {
		if (activeView === "all") return visibleSectionId === itemId;
		if (activeView === itemId) return true;
		if (activeView === "general") return (visibleInGroup("general") ?? "app-info") === itemId;
		if (activeView === "appearance") return (visibleInGroup("appearance") ?? "theme") === itemId;
		if (activeView === "features") return false;
		if (activeView === "ai") return (visibleInGroup("ai") ?? "ai-provider") === itemId;
		return false;
	}

	// Check if a group label is active (for scroll spy highlighting)
	function isGroupActive(groupId: SettingsGroup): boolean {
		if (activeView === "all" && visibleSectionId) return sectionToGroup[visibleSectionId] === groupId;
		if (activeView === groupId) return true;
		if (!isGroupView() && activeView) return sectionToGroup[activeView] === groupId;
		return false;
	}

	// License section state
	let showActivationInput = $state(false);
	let licenseKeyInput = $state("");
	let isRetrying = $state(false);

	async function handleRetryValidation() {
		isRetrying = true;
		try {
			const success = await licenseStore.retryValidation();
			if (success) {
				toast.success(m.license_revalidated_success());
			} else {
				errorToast(m.license_revalidation_failed());
			}
		} finally {
			isRetrying = false;
		}
	}

	async function handleActivate() {
		if (!licenseKeyInput.trim()) return;
		const success = await licenseStore.activate(licenseKeyInput.trim());
		if (success) {
			toast.success(m.license_activate_success());
			licenseKeyInput = "";
			showActivationInput = false;
		}
	}

	async function handleDeactivate() {
		const success = await licenseStore.deactivate();
		if (success) {
			toast.success(m.license_deactivate_success());
		} else {
			errorToast(m.license_deactivate_failed());
		}
	}

	// AI provider management state
	let isAddingProvider = $state(false);
	let editingProviderId = $state<string | null>(null);
	let providerFormName = $state("");
	let providerFormType = $state<"anthropic" | "openai-compatible">("anthropic");
	let providerFormBaseUrl = $state("");
	let providerFormApiKey = $state("");
	let providerFormHasExistingKey = $state(false);
	let providerFormClearKey = $state(false);
	let isSavingProvider = $state(false);
	let providerTestStatus = $state<Record<string, "idle" | "success" | "failed">>({});
	let isTestingProvider = $state<Record<string, boolean>>({});

	function startAddProvider() {
		editingProviderId = null;
		providerFormName = "";
		providerFormType = "anthropic";
		providerFormBaseUrl = "";
		providerFormApiKey = "";
		providerFormHasExistingKey = false;
		providerFormClearKey = false;
		isAddingProvider = true;
	}

	async function startEditProvider(config: import("$lib/types/ai").AIProvider) {
		isAddingProvider = false;
		providerFormName = config.name;
		providerFormType = config.type;
		providerFormBaseUrl = config.baseUrl ?? "";
		providerFormApiKey = "";
		providerFormHasExistingKey = !!(await getKeyringService().getAIApiKeyForProvider(config.id));
		providerFormClearKey = false;
		editingProviderId = config.id;
	}

	function cancelProviderForm() {
		isAddingProvider = false;
		editingProviderId = null;
	}

	async function saveProviderForm() {
		if (!providerFormName.trim()) return;
		isSavingProvider = true;
		try {
			const sqliteDb = await getDatabase();
			if (editingProviderId) {
				const existing = aiSettingsStore.settings.providers.find(p => p.id === editingProviderId);
				if (!existing) { isSavingProvider = false; return; }
				await aiSettingsStore.updateProvider(sqliteDb, {
					...existing,
					name: providerFormName.trim(),
					type: providerFormType,
					baseUrl: providerFormBaseUrl.trim(),
				}, providerFormClearKey ? "" : (providerFormApiKey || undefined));
				if (providerFormApiKey.trim()) providerFormHasExistingKey = true;
			} else {
				const id = crypto.randomUUID();
				await aiSettingsStore.addProvider(sqliteDb, {
					id,
					name: providerFormName.trim(),
					type: providerFormType,
					baseUrl: providerFormBaseUrl.trim(),
				}, providerFormApiKey || undefined);
			}
			providerFormApiKey = "";
			cancelProviderForm();
			toast.success(m.settings_ai_saved());
		} finally {
			isSavingProvider = false;
		}
	}

	function confirmDeleteProvider(id: string) {
		providerToDelete = id;
		deleteProviderDialogOpen = true;
	}

	async function executeDeleteProvider() {
		if (!providerToDelete) return;
		const sqliteDb = await getDatabase();
		await aiSettingsStore.deleteProvider(sqliteDb, providerToDelete);
		providerToDelete = null;
		deleteProviderDialogOpen = false;
	}

	async function testProviderConnection(id: string) {
		isTestingProvider = { ...isTestingProvider, [id]: true };
		providerTestStatus = { ...providerTestStatus, [id]: "idle" };
		try {
			const ok = await aiSettingsStore.testConnection(id);
			providerTestStatus = { ...providerTestStatus, [id]: ok ? "success" : "failed" };
		} catch {
			providerTestStatus = { ...providerTestStatus, [id]: "failed" };
		} finally {
			isTestingProvider = { ...isTestingProvider, [id]: false };
		}
	}

	// Internal database connection
	let isConnectingInternal = $state(false);

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

	// Theme display helpers
	const lightThemeLabel = $derived(themeStore.selectedLightTheme.name);
	const darkThemeLabel = $derived(themeStore.selectedDarkTheme.name);

	// Scroll spy for highlighting visible section in sidebar nav
	let scrollContainer = $state<HTMLElement | null>(null);
	let visibleSectionId = $state<string | null>(null);

	$effect(() => {
		const container = scrollContainer;
		if (!container) return;

		// Re-run when activeView changes (sections get mounted/unmounted)
		const _view = activeView;

		const sectionEls = container.querySelectorAll<HTMLElement>("[data-section]");
		if (sectionEls.length === 0) return;

		const observer = new IntersectionObserver(
			(entries) => {
				// Find the topmost visible section
				let topSection: { id: string; top: number } | null = null;
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const rect = entry.boundingClientRect;
						if (!topSection || rect.top < topSection.top) {
							topSection = { id: entry.target.getAttribute("data-section")!, top: rect.top };
						}
					}
				}
				if (topSection) {
					visibleSectionId = topSection.id;
				}
			},
			{ root: container, rootMargin: "0px 0px -60% 0px", threshold: 0 },
		);

		for (const el of sectionEls) {
			observer.observe(el);
		}

		return () => observer.disconnect();
	});
</script>

<Sidebar.Provider style="min-height: 0;" class="h-full">
	<Sidebar.Root collapsible="none" class="hidden md:flex border-r">
		<Sidebar.Content>
			{#each navGroups as group (group.id)}
			{#if group.id !== "ai" || aiSettingsStore.settings.enabled}
				<Sidebar.Group>
					<Sidebar.GroupLabel
						class="gap-2 cursor-pointer hover:text-foreground transition-colors {isGroupActive(group.id) ? 'text-foreground' : ''}"
						onclick={() => setView(group.id)}
					>
						<group.icon class="size-4" />
						<span>{group.name}</span>
					</Sidebar.GroupLabel>
					<Sidebar.GroupContent>
						<Sidebar.Menu>
							{#each group.items as item (item.id)}
								<Sidebar.MenuItem>
									<Sidebar.MenuButton
										isActive={isItemActive(item.id)}
										onclick={() => setView(item.id)}
									>
										<item.icon class="size-4" />
										<span>{item.name}</span>
									</Sidebar.MenuButton>
								</Sidebar.MenuItem>
							{/each}
						</Sidebar.Menu>
					</Sidebar.GroupContent>
				</Sidebar.Group>
			{/if}
			{/each}
		</Sidebar.Content>
	</Sidebar.Root>
	<main class="flex flex-1 flex-col overflow-hidden">
		<header
			class="flex h-12 shrink-0 items-center gap-2 border-b"
		>
			<div class="flex items-center gap-2 px-4">
				<Breadcrumb.Root>
					<Breadcrumb.List>
						<Breadcrumb.Item class="hidden md:block">
							{#if activeView === "all"}
								<Breadcrumb.Page>{m.settings_title()}</Breadcrumb.Page>
							{:else}
								<Breadcrumb.Link href="#" onclick={() => setView("all")}>
									{m.settings_title()}
								</Breadcrumb.Link>
							{/if}
						</Breadcrumb.Item>
						{#if activeView !== "all"}
							<Breadcrumb.Separator class="hidden md:block" />
							<Breadcrumb.Item class="hidden md:block">
								{#if activeSectionName()}
									<Breadcrumb.Link
										href="#"
										onclick={() => setView(activeGroupObj()?.id ?? "general")}
									>
										{activeGroupObj()?.name}
									</Breadcrumb.Link>
								{:else}
									<Breadcrumb.Page>{activeGroupObj()?.name}</Breadcrumb.Page>
								{/if}
							</Breadcrumb.Item>
							{#if activeSectionName()}
								<Breadcrumb.Separator class="hidden md:block" />
								<Breadcrumb.Item>
									<Breadcrumb.Page>{activeSectionName()}</Breadcrumb.Page>
								</Breadcrumb.Item>
							{/if}
						{/if}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</div>
		</header>
		<div class="flex flex-1 flex-col gap-6 overflow-y-auto p-4 pt-4" bind:this={scrollContainer}>
			{#if shouldShowSection("app-info")}
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
			{/if}

			{#if shouldShowSection("license")}
			<div class="space-y-6" data-section="license">
				<div>
					<h2 class="text-lg font-medium">{m.settings_license()}</h2>
					<p class="text-sm text-muted-foreground mt-1">
						{m.settings_license_description()}
					</p>
				</div>

				{#if licenseStore.status === "active"}
					<div class="space-y-4 border rounded-lg p-4">
						<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
							<span class="text-muted-foreground">{m.license_status_label()}</span>
							<span>
								<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
									{m.license_status_active()}
								</span>
							</span>
						</div>
						<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
							<span class="text-muted-foreground">{m.license_tier_label()}</span>
							<span class="font-medium">
								{#if licenseStore.tier === "individual"}
									{m.license_tier_individual()}
								{:else if licenseStore.tier === "business"}
									{m.license_tier_business()}
								{:else}
									{m.license_tier_personal()}
								{/if}
							</span>
						</div>
						{#if licenseStore.maskedKey}
							<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
								<span class="text-muted-foreground">{m.license_key_label()}</span>
								<span class="font-mono">{licenseStore.maskedKey}</span>
							</div>
						{/if}
						{#if licenseStore.expiresAt}
							<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
								<span class="text-muted-foreground">{m.license_expires_at()}</span>
								<span>{new Date(licenseStore.expiresAt).toLocaleDateString()}</span>
							</div>
						{/if}
						{#if licenseStore.lastValidatedAt}
							<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
								<span class="text-muted-foreground">{m.license_last_validated()}</span>
								<span>{new Date(licenseStore.lastValidatedAt).toLocaleString()}</span>
							</div>
						{/if}
						<div class="pt-2">
							<Button variant="outline" size="sm" onclick={handleDeactivate}>
								{m.license_deactivate_button()}
							</Button>
						</div>
					</div>
				{:else if licenseStore.status === "expired" || licenseStore.status === "invalid"}
					<div class="space-y-4 border border-destructive/50 rounded-lg p-4">
						<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
							<span class="text-muted-foreground">{m.license_status_label()}</span>
							<span>
								<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
									{licenseStore.status === "expired" ? m.license_status_expired() : m.license_status_invalid()}
								</span>
							</span>
						</div>
						<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
							<span class="text-muted-foreground">{m.license_tier_label()}</span>
							<span class="font-medium">
								{#if licenseStore.tier === "individual"}
									{m.license_tier_individual()}
								{:else if licenseStore.tier === "business"}
									{m.license_tier_business()}
								{:else}
									{m.license_tier_personal()}
								{/if}
							</span>
						</div>
						{#if licenseStore.maskedKey}
							<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
								<span class="text-muted-foreground">{m.license_key_label()}</span>
								<span class="font-mono">{licenseStore.maskedKey}</span>
							</div>
						{/if}
						{#if licenseStore.expiresAt}
							<div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
								<span class="text-muted-foreground">{m.license_expires_at()}</span>
								<span>{new Date(licenseStore.expiresAt).toLocaleDateString()}</span>
							</div>
						{/if}
						<p class="text-sm text-muted-foreground">
							{licenseStore.status === "expired" ? m.license_expired_message() : m.license_invalid_message()}
						</p>
						<div class="flex gap-2 pt-2">
							<Button variant="default" size="sm" onclick={handleRetryValidation} disabled={isRetrying}>
								{isRetrying ? m.license_retrying() : m.license_retry_validation()}
							</Button>
							<Button variant="outline" size="sm" onclick={() => showActivationInput = true}>
								{m.license_enter_new_key()}
							</Button>
							<Button variant="ghost" size="sm" onclick={handleDeactivate}>
								{m.license_deactivate_button()}
							</Button>
						</div>
						{#if showActivationInput}
							<div class="space-y-2 min-w-0 border-t pt-4">
								<input
									type="text"
									class="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
									placeholder={m.license_key_placeholder()}
									bind:value={licenseKeyInput}
									onkeydown={(e) => e.key === "Enter" && handleActivate()}
								/>
								{#if licenseStore.activationError}
									<div class="flex items-start gap-1.5 text-sm text-destructive">
										<p class="break-all flex-1">{licenseStore.activationError}</p>
										<button
											class="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
											title="Copy error"
											onclick={() => navigator.clipboard.writeText(licenseStore.activationError ?? "")}
										>
											<CopyIcon class="size-3.5" />
										</button>
									</div>
								{/if}
								<Button
									size="sm"
									onclick={handleActivate}
									disabled={licenseStore.isActivating || !licenseKeyInput.trim()}
								>
									{m.license_activate_button()}
								</Button>
							</div>
						{/if}
					</div>
				{:else}
					<div class="space-y-4">
						<p class="text-sm text-muted-foreground">
							{m.license_activate_description()}
						</p>
						{#if showActivationInput}
							<div class="space-y-2 min-w-0">
								<input
									type="text"
									class="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
									placeholder={m.license_key_placeholder()}
									bind:value={licenseKeyInput}
									onkeydown={(e) => e.key === "Enter" && handleActivate()}
								/>
								{#if licenseStore.activationError}
									<div class="flex items-start gap-1.5 text-sm text-destructive">
										<p class="break-all flex-1">{licenseStore.activationError}</p>
										<button
											class="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
											title="Copy error"
											onclick={() => navigator.clipboard.writeText(licenseStore.activationError ?? "")}
										>
											<CopyIcon class="size-3.5" />
										</button>
									</div>
								{/if}
								<Button
									size="sm"
									onclick={handleActivate}
									disabled={licenseStore.isActivating || !licenseKeyInput.trim()}
								>
									{m.license_activate_button()}
								</Button>
							</div>
						{:else}
							<Button variant="outline" size="sm" onclick={() => showActivationInput = true}>
								{m.license_activate()}
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if shouldShowSection("query-history")}
		<div class="space-y-6" data-section="query-history">
			<div>
				<h2 class="text-lg font-medium">{m.settings_query_history()}</h2>
				<p class="text-sm text-muted-foreground mt-1">{m.settings_query_history_description()}</p>
			</div>
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium">{m.settings_query_version_limit()}</p>
						<p class="text-sm text-muted-foreground">{m.settings_query_version_limit_description()}</p>
					</div>
					<input
						type="number"
						min="10"
						max="1000"
						bind:value={queryVersionLimit}
						onchange={async () => {
							const db = await getDatabase();
							await appStateRepo.set(db, "query_version_limit", String(queryVersionLimit));
						}}
						class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
					/>
				</div>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium">{m.settings_dashboard_version_limit()}</p>
						<p class="text-sm text-muted-foreground">{m.settings_dashboard_version_limit_description()}</p>
					</div>
					<input
						type="number"
						min="10"
						max="1000"
						bind:value={dashboardVersionLimit}
						onchange={async () => {
							const db = await getDatabase();
							await appStateRepo.set(db, "dashboard_version_limit", String(dashboardVersionLimit));
						}}
						class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
					/>
				</div>
			</div>
		</div>
		{/if}

		{#if shouldShowSection("theme")}
				<div class="space-y-6" data-section="theme">
					<div>
						<h2 class="text-lg font-medium">{m.settings_theme()}</h2>
						<p class="text-sm text-muted-foreground mt-1">
							{m.settings_theme_description()}
						</p>
					</div>

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">{m.settings_theme_label()}</p>
								<p class="text-xs text-muted-foreground">
									Choose between light, dark, or system mode
								</p>
							</div>
							<Select
								type="single"
								value={currentMode}
								onValueChange={handleModeChange}
							>
								<SelectTrigger class="w-32">
									{modeLabel}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="light">{m.theme_light()}</SelectItem>
									<SelectItem value="dark">{m.theme_dark()}</SelectItem>
									<SelectItem value="system">{m.theme_system()}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			{/if}

			{#if shouldShowSection("themes")}
				<div class="space-y-6" data-section="themes">
					<div>
						<h2 class="text-lg font-medium">{m.settings_themes()}</h2>
						<p class="text-sm text-muted-foreground mt-1">
							{m.settings_themes_description()}
						</p>
					</div>

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">{m.settings_themes_light_mode()}</p>
								<p class="text-xs text-muted-foreground">
									{m.settings_themes_light_mode_description()}
								</p>
							</div>
							<Select
								type="single"
								value={themeStore.preferences.lightThemeId}
								onValueChange={handleLightThemeChange}
							>
								<SelectTrigger class="w-48">
									{lightThemeLabel}
								</SelectTrigger>
								<SelectContent>
									{#each themeStore.lightThemes as theme (theme.id)}
										<SelectItem value={theme.id}>{theme.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>

						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">{m.settings_themes_dark_mode()}</p>
								<p class="text-xs text-muted-foreground">
									{m.settings_themes_dark_mode_description()}
								</p>
							</div>
							<Select
								type="single"
								value={themeStore.preferences.darkThemeId}
								onValueChange={handleDarkThemeChange}
							>
								<SelectTrigger class="w-48">
									{darkThemeLabel}
								</SelectTrigger>
								<SelectContent>
									{#each themeStore.darkThemes as theme (theme.id)}
										<SelectItem value={theme.id}>{theme.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-medium">{m.settings_themes_user_themes()}</h3>
							<div class="flex gap-2">
								<Button variant="outline" size="sm" onclick={importTheme}>
									<UploadIcon class="size-4 mr-1" />
									{m.settings_themes_import()}
								</Button>
								<Button variant="outline" size="sm" onclick={openCreateTheme}>
									<PlusIcon class="size-4 mr-1" />
									{m.settings_themes_create_new()}
								</Button>
							</div>
						</div>

						{#if themeStore.userThemes.length === 0}
							<div class="text-center py-6 border rounded-lg bg-muted/30">
								<p class="text-sm text-muted-foreground">{m.settings_themes_no_user_themes()}</p>
								<p class="text-xs text-muted-foreground mt-1">{m.settings_themes_no_user_themes_hint()}</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each themeStore.userThemes as theme (theme.id)}
									<div class="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
										<div class="flex items-center gap-3">
											<ThemePreview colors={theme.colors} />
											<div>
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium">{theme.name}</span>
													{#if themeStore.isThemeActive(theme.id)}
														<span class="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
															{m.theme_card_active()}
														</span>
													{/if}
												</div>
												<span class="text-xs text-muted-foreground">
													{theme.isDark ? m.theme_dark() : m.theme_light()}
												</span>
											</div>
										</div>
										<div class="flex items-center gap-1">
											<Button variant="ghost" size="icon" class="size-8" onclick={() => openEditTheme(theme)} title={m.theme_card_edit()}>
												<PaletteIcon class="size-4" />
											</Button>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => duplicateTheme(theme)} title={m.theme_card_duplicate()}>
												<CopyIcon class="size-4" />
											</Button>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => exportTheme(theme)} title={m.theme_card_export()}>
												<DownloadIcon class="size-4" />
											</Button>
											<Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" onclick={() => confirmDeleteTheme(theme)} title={m.theme_card_delete()}>
												<TrashIcon class="size-4" />
											</Button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="space-y-3">
						<h3 class="text-sm font-medium">{m.settings_themes_builtin_themes()}</h3>
						<div class="space-y-2">
							{#each themeStore.allThemes.filter(t => t.isBuiltIn) as theme (theme.id)}
								<div class="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
									<div class="flex items-center gap-3">
										<ThemePreview colors={theme.colors} />
										<div>
											<div class="flex items-center gap-2">
												<span class="text-sm font-medium">{theme.name}</span>
												{#if themeStore.isThemeActive(theme.id)}
													<span class="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
														{m.theme_card_active()}
													</span>
												{/if}
											</div>
											<span class="text-xs text-muted-foreground">
												{theme.isDark ? m.theme_dark() : m.theme_light()}
												{#if theme.author}
													&middot; {theme.author}
												{/if}
											</span>
										</div>
									</div>
									<div class="flex items-center gap-1">
										<Button variant="ghost" size="icon" class="size-8" onclick={() => duplicateTheme(theme)} title={m.theme_card_duplicate()}>
											<CopyIcon class="size-4" />
										</Button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			{#if shouldShowSection("ai-feature") || shouldShowSection("learn")}
				<div class="space-y-4" data-section="ai-feature">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">{m.settings_ai_feature()}</p>
							<p class="text-xs text-muted-foreground">
								{m.settings_ai_feature_enabled_description()}
							</p>
						</div>
						<Switch
							checked={aiSettingsStore.settings.enabled}
							onCheckedChange={handleAIToggle}
						/>
					</div>
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">{m.settings_learn()}</p>
							<p class="text-xs text-muted-foreground">
								{m.settings_learn_enabled_description()}
							</p>
						</div>
						<Switch
							checked={onboardingStore.learnEnabled}
							onCheckedChange={handleLearnToggle}
						/>
					</div>
				</div>
			{/if}

			{#if shouldShowSection("ai-provider")}
				<div class="space-y-6" data-section="ai-provider">
					<div>
						<h2 class="text-lg font-medium">{m.settings_ai_provider()}</h2>
						<p class="text-sm text-muted-foreground mt-1">
							{m.settings_ai_provider_description()}
						</p>
					</div>

					<div class="space-y-3">
						{#if aiSettingsStore.settings.providers.length === 0 && !isAddingProvider}
							<p class="text-sm text-muted-foreground">{m.settings_ai_no_providers()}</p>
						{/if}

						{#each aiSettingsStore.settings.providers as config (config.id)}
							<div class="flex items-center justify-between rounded-lg border px-3 py-2.5" class:opacity-50={editingProviderId !== null && editingProviderId !== config.id}>
								<div class="flex items-center gap-3">
									<div>
										<p class="text-sm font-medium">{config.name}</p>
										<p class="text-xs text-muted-foreground">{config.type === "anthropic" ? m.settings_ai_provider_anthropic() : m.settings_ai_provider_openai_compatible()}</p>
									</div>
								</div>
								<div class="flex items-center gap-1">
									{#if providerTestStatus[config.id] === "success"}
										<span class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mr-1">
											<CheckIcon class="size-3" />{m.settings_ai_test_success()}
										</span>
									{:else if providerTestStatus[config.id] === "failed"}
										<span class="text-xs text-destructive mr-1">{m.settings_ai_test_failed()}</span>
									{/if}
									<Button
										size="icon"
										variant="ghost"
										class="size-7"
										disabled={isTestingProvider[config.id]}
										onclick={() => testProviderConnection(config.id)}
										title={m.settings_ai_test_connection()}
									>
										<SparklesIcon class="size-3.5" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										class="size-7"
										onclick={() => startEditProvider(config)}
										title={m.settings_ai_edit_provider()}
									>
										<PencilIcon class="size-3.5" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										class="size-7 text-destructive hover:text-destructive"
										onclick={() => confirmDeleteProvider(config.id)}
										title={m.settings_ai_delete_provider()}
									>
										<TrashIcon class="size-3.5" />
									</Button>
								</div>
							</div>
						{/each}

						{#if isAddingProvider || editingProviderId}
							<div class="rounded-lg border p-4 space-y-3">
								<p class="text-sm font-medium">{isAddingProvider ? m.settings_ai_add_provider() : m.settings_ai_edit_provider()}</p>
								<div class="space-y-1">
									<p class="text-xs font-medium text-muted-foreground">{m.settings_ai_provider_name()}</p>
									<input
										type="text"
										class="w-full px-3 py-2 border rounded-md bg-background text-sm"
										placeholder={m.settings_ai_provider_name_placeholder()}
										bind:value={providerFormName}
									/>
								</div>
								<select
									class="w-full px-3 py-2 h-10 border rounded-md bg-background text-sm"
									bind:value={providerFormType}
								>
									<option value="anthropic">{m.settings_ai_provider_anthropic()}</option>
									<option value="openai-compatible">{m.settings_ai_provider_openai_compatible()}</option>
								</select>
								<div class="space-y-1">
									{#if providerFormHasExistingKey}
										<div class="flex items-center gap-2">
											<p class="text-xs text-green-600 dark:text-green-400">{m.settings_ai_key_saved()}</p>
											<button
												type="button"
												class="text-xs text-muted-foreground hover:text-foreground underline"
												onclick={() => { providerFormHasExistingKey = false; providerFormClearKey = true; }}
											>{m.settings_ai_clear_key()}</button>
										</div>
									{/if}
									<input
										type="password"
										class="w-full px-3 py-2 border rounded-md bg-background text-sm"
										placeholder={providerFormHasExistingKey ? "***" : m.settings_ai_api_key_placeholder()}
										bind:value={providerFormApiKey}
									/>
								</div>
								{#if providerFormType === "openai-compatible"}
									<input
										type="text"
										class="w-full px-3 py-2 border rounded-md bg-background text-sm"
										placeholder={m.settings_ai_base_url_placeholder()}
										bind:value={providerFormBaseUrl}
									/>
								{/if}
								<div class="flex items-center gap-2">
									<Button size="sm" onclick={saveProviderForm} disabled={isSavingProvider || !providerFormName.trim()}>
										{m.settings_ai_save()}
									</Button>
									<Button size="sm" variant="ghost" onclick={cancelProviderForm}>{m.common_cancel()}</Button>
								</div>
							</div>
						{:else}
							<Button variant="outline" size="sm" onclick={startAddProvider}>
								<PlusIcon class="size-3.5 mr-1" />
								{m.settings_ai_add_provider()}
							</Button>
						{/if}
					</div>
				</div>
			{/if}

			{#if shouldShowSection("ai-privacy")}
				<div class="space-y-6" data-section="ai-privacy">
					<div>
						<h2 class="text-lg font-medium">{m.settings_ai_privacy()}</h2>
						<p class="text-sm text-muted-foreground mt-1">
							{m.settings_ai_privacy_description()}
						</p>
					</div>

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">{m.settings_ai_share_schema_globally()}</p>
								<p class="text-xs text-muted-foreground">
									{m.settings_ai_share_schema_globally_description()}
								</p>
							</div>
							<Switch
								checked={aiSettingsStore.settings.shareSchemaGlobally}
								onCheckedChange={async (checked) => {
									const sqliteDb = await getDatabase();
									await aiSettingsStore.savePrivacySettings(sqliteDb, { shareSchemaGlobally: checked, shareDataGlobally: aiSettingsStore.settings.shareDataGlobally });
								}}
							/>
						</div>

						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">{m.settings_ai_share_data_globally()}</p>
								<p class="text-xs text-muted-foreground">
									{m.settings_ai_share_data_globally_description()}
								</p>
							</div>
							<Switch
								checked={aiSettingsStore.settings.shareDataGlobally}
								onCheckedChange={async (checked) => {
									const sqliteDb = await getDatabase();
									await aiSettingsStore.savePrivacySettings(sqliteDb, { shareSchemaGlobally: aiSettingsStore.settings.shareSchemaGlobally, shareDataGlobally: checked });
								}}
							/>
						</div>
					</div>

					{#if !aiSettingsStore.settings.shareSchemaGlobally && !aiSettingsStore.settings.shareDataGlobally}
						<p class="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
							{m.settings_ai_no_context_note()}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</main>
</Sidebar.Provider>

<!-- Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{m.theme_delete_title()}</AlertDialog.Title>
			<AlertDialog.Description>
				{m.theme_delete_description({ name: themeToDelete?.name ?? "" })}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{m.theme_delete_cancel()}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={deleteTheme} class="bg-destructive text-white hover:bg-destructive/90">
				{m.theme_delete_confirm()}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Provider Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={deleteProviderDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{m.settings_ai_delete_provider()}</AlertDialog.Title>
			<AlertDialog.Description>
				{#if providerToDelete}
					{@const name = aiSettingsStore.settings.providers.find(p => p.id === providerToDelete)?.name ?? "this provider"}
					This will permanently delete "{name}" and its API key. This cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={executeDeleteProvider} class="bg-destructive text-white hover:bg-destructive/90">
				{m.theme_delete_confirm()}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
