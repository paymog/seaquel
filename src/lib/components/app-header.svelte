<script lang="ts">
    import SidebarIcon from "@lucide/svelte/icons/sidebar";
    import { isMac } from "$lib/shortcuts/platform";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
    import CheckIcon from "@lucide/svelte/icons/check";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import ConnectionWizard from "$lib/components/connection-wizard/connection-wizard.svelte";
    import PlusIcon from "@lucide/svelte/icons/plus";
    import BotIcon from "@lucide/svelte/icons/bot";
    import NetworkIcon from "@lucide/svelte/icons/network";
    import SettingsIcon from "@lucide/svelte/icons/settings";
    import { toast } from "svelte-sonner";
    import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
    import CircleDollarSignIcon from "@lucide/svelte/icons/circle-dollar-sign";
    import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
    import MessageSquareTextIcon from "@lucide/svelte/icons/message-square-text";
    import BookOpenIcon from "@lucide/svelte/icons/book-open";
    import LanguageToggle from "./language-toggle.svelte";
    import { m } from "$lib/paraglide/messages.js";
    import { DEFAULT_PROJECT_ID } from "$lib/types";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { licenseStore } from "$lib/stores/license.svelte.js";
    import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
    import { isTauri } from "$lib/utils/environment";
    import { page } from "$app/state";
    import { resolve } from "$app/paths";

    let appVersion = $state("");

    $effect(() => {
        if (isTauri()) {
            import("@tauri-apps/api/app").then(({ getVersion }) => {
                getVersion().then((v) => {
                    appVersion = v;
                });
            });
        }
    });

    let checkingForUpdates = $state(false);

    const checkForUpdates = async () => {
        checkingForUpdates = true;
        try {
            const { checkForUpdate } = await import("$lib/api/tauri");
            const newVersion = await checkForUpdate();
            if (!newVersion) {
                toast.info(`You're on the latest version`, {
                    description: `Seaquel v${appVersion}`,
                });
            }
            // If newVersion exists, the existing update-downloaded listener in +layout.svelte
            // will handle showing the update toast once the download completes
        } catch {
            toast.error("Failed to check for updates");
        } finally {
            checkingForUpdates = false;
        }
    };

    const openExternal = (url: string) => {
        if (isTauri()) {
            import("$lib/api/tauri").then(({ openPath }) => {
                openPath(url);
            });
        } else {
            window.open(url, "_blank");
        }
    };

    const isLearnPage = $derived(page.url.pathname.startsWith(resolve("/learn")));

    const db = useDatabase();
    const sidebar = Sidebar.useSidebar();

    // Project management state
    let showNewProjectDialog = $state(false);
    let showEditProjectDialog = $state(false);
    let showRemoveProjectDialog = $state(false);
    let newProjectName = $state("");
    let editProjectName = $state("");
    let projectToEdit = $state<string | null>(null);
    let projectToRemove = $state<string | null>(null);
    let projectToRemoveName = $state("");

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        await db.projects.add(newProjectName.trim());
        newProjectName = "";
        showNewProjectDialog = false;
    };

    const handleEditProject = async () => {
        if (!projectToEdit || !editProjectName.trim()) return;
        db.projects.update(projectToEdit, { name: editProjectName.trim() });
        projectToEdit = null;
        editProjectName = "";
        showEditProjectDialog = false;
    };

    const openEditDialog = (projectId: string, name: string) => {
        projectToEdit = projectId;
        editProjectName = name;
        showEditProjectDialog = true;
    };

    const confirmRemoveProject = (projectId: string, name: string) => {
        projectToRemove = projectId;
        projectToRemoveName = name;
        showRemoveProjectDialog = true;
    };

    const handleRemoveProject = async () => {
        if (projectToRemove) {
            await db.projects.remove(projectToRemove);
            projectToRemove = null;
            projectToRemoveName = "";
        }
        showRemoveProjectDialog = false;
    };
</script>

<header
    class="bg-background sticky top-0 z-50 flex w-lvw items-center border-b"
>
    <div
        data-tauri-drag-region
        class="h-(--header-height) flex w-full items-center pr-2"
    >
        <!-- Left section: sidebar toggle + project dropdown (fixed sidebar width) -->
        <div data-tauri-drag-region class="flex items-center gap-1 shrink-0 w-(--sidebar-width) {isMac() ? 'pl-18' : 'pl-2'}">
            <Button
                class="size-8 shrink-0"
                variant="ghost"
                size="icon"
                onclick={sidebar.toggle}
            >
                <SidebarIcon />
            </Button>
            <!-- Project Dropdown -->
            <DropdownMenu.Root>
                <DropdownMenu.Trigger class="flex items-center gap-2 px-3 h-8 text-sm rounded-md bg-background hover:bg-muted transition-colors">
                    <span class="max-w-40 truncate" title={db.state.activeProject?.name || m.project_default_name()}>
                        {db.state.activeProject?.name || m.project_default_name()}
                    </span>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content class="w-56" align="start">
                    {#each db.state.projects as project (project.id)}
                        <ContextMenu.Root>
                            <ContextMenu.Trigger class="w-full">
                                <DropdownMenu.Item
                                    class="flex items-center gap-2 cursor-pointer"
                                    onclick={() => db.projects.setActive(project.id)}
                                >
                                    <span class="w-4">
                                        {#if db.state.activeProjectId === project.id}
                                            <CheckIcon class="size-4" />
                                        {/if}
                                    </span>
                                    <span class="flex-1 truncate">{project.name}</span>
                                </DropdownMenu.Item>
                            </ContextMenu.Trigger>
                            <ContextMenu.Content class="w-40">
                                <ContextMenu.Item onclick={() => openEditDialog(project.id, project.name)}>
                                    {m.project_edit()}
                                </ContextMenu.Item>
                                {#if project.id !== DEFAULT_PROJECT_ID && db.state.projects.length > 1}
                                    <ContextMenu.Separator />
                                    <ContextMenu.Item
                                        class="text-destructive focus:text-destructive"
                                        onclick={() => confirmRemoveProject(project.id, project.name)}
                                    >
                                        {m.project_delete()}
                                    </ContextMenu.Item>
                                {/if}
                            </ContextMenu.Content>
                        </ContextMenu.Root>
                    {/each}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                        class="flex items-center gap-2 cursor-pointer"
                        onclick={() => showNewProjectDialog = true}
                    >
                        <PlusIcon class="size-4" />
                        {m.project_new()}
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>

        <!-- Middle section: empty drag space -->
        <div data-tauri-drag-region class="flex-1 min-w-0 h-full"></div>

        <!-- Right section: action buttons -->
        <div class="flex items-center gap-1 shrink-0">
            {#if isTauri()}
                <button
                    class="cursor-pointer"
                    onclick={() => settingsDialogStore.open("license")}
                >
                    <Badge variant={licenseStore.status === "active" ? "default" : licenseStore.status === "expired" || licenseStore.status === "invalid" ? "destructive" : "secondary"}>
                        {licenseStore.badgeLabel}
                    </Badge>
                </button>
            {/if}
            {#if !isLearnPage && (db.state.activeConnection?.database || db.state.activeConnection?.mssqlConnectionId || db.state.activeConnection?.providerConnectionId)}
                <Button
                    size="icon"
                    variant="ghost"
                    class="size-6"
                    title={m.header_view_erd()}
                    aria-label={m.header_view_erd()}
                    onclick={() => db.erdTabs.add()}
                >
                    <NetworkIcon class="size-3.5" />
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    class="size-6"
                    title={m.header_toggle_ai()}
                    aria-label={m.header_toggle_ai()}
                    onclick={() => db.ui.toggleAI()}
                >
                    <BotIcon class="size-3.5" />
                </Button>
            {/if}
            <LanguageToggle />
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                        <Button
                            {...props}
                            size="icon"
                            variant="ghost"
                            class="size-6"
                            title={m.header_settings()}
                            aria-label={m.header_settings()}
                        >
                            <SettingsIcon class="size-3.5" />
                        </Button>
                    {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content class="w-52" align="end">
                    <DropdownMenu.Item onclick={() => settingsDialogStore.open()}>
                        Settings
                        <DropdownMenu.Shortcut>⌘,</DropdownMenu.Shortcut>
                    </DropdownMenu.Item>
                    <div class="flex items-center gap-2 px-2 py-1.5">
                        <div class="h-px flex-1 bg-border"></div>
                        <span class="text-muted-foreground text-xs shrink-0">Seaquel{appVersion ? ` v${appVersion}` : ""}</span>
                        <div class="h-px flex-1 bg-border"></div>
                    </div>
                    {#if isTauri() && licenseStore.status !== "active"}
                        <DropdownMenu.Item
                            class="text-emerald-600 dark:text-emerald-400 focus:text-emerald-600 dark:focus:text-emerald-400"
                            onclick={() => settingsDialogStore.open("license")}
                        >
                            <CircleDollarSignIcon class="size-4" />
                            Purchase License
                        </DropdownMenu.Item>
                    {/if}
                    {#if isTauri()}
                        <DropdownMenu.Item onclick={checkForUpdates} disabled={checkingForUpdates}>
                            <RefreshCwIcon class="size-4 {checkingForUpdates ? 'animate-spin' : ''}" />
                            {checkingForUpdates ? "Checking..." : "Check for Updates"}
                        </DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Item onclick={() => openExternal("https://github.com/webstonehq/seaquel/issues")}>
                        <MessageSquareTextIcon class="size-4" />
                        Feedback
                        <DropdownMenu.Shortcut><ExternalLinkIcon class="size-3" /></DropdownMenu.Shortcut>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => openExternal("https://seaquel.app/changelog")}>
                        <BookOpenIcon class="size-4" />
                        Changelog
                        <DropdownMenu.Shortcut><ExternalLinkIcon class="size-3" /></DropdownMenu.Shortcut>
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>
    </div>
</header>

<ConnectionWizard />

<!-- New Project Dialog -->
<Dialog.Root bind:open={showNewProjectDialog}>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>{m.project_new_dialog_title()}</Dialog.Title>
            <Dialog.Description>
                {m.project_new_dialog_description()}
            </Dialog.Description>
        </Dialog.Header>
        <div class="py-4">
            <input
                type="text"
                class="w-full px-3 py-2 border rounded-md bg-background"
                placeholder={m.project_name_placeholder()}
                bind:value={newProjectName}
                onkeydown={(e) => e.key === "Enter" && handleCreateProject()}
            />
        </div>
        <Dialog.Footer class="gap-2">
            <Button variant="outline" onclick={() => { showNewProjectDialog = false; newProjectName = ""; }}>
                {m.header_button_cancel()}
            </Button>
            <Button onclick={handleCreateProject} disabled={!newProjectName.trim()}>
                {m.project_create()}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<!-- Edit Project Dialog -->
<Dialog.Root bind:open={showEditProjectDialog}>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>{m.project_edit_dialog_title()}</Dialog.Title>
        </Dialog.Header>
        <div class="py-4">
            <input
                type="text"
                class="w-full px-3 py-2 border rounded-md bg-background"
                placeholder={m.project_name_placeholder()}
                bind:value={editProjectName}
                onkeydown={(e) => e.key === "Enter" && handleEditProject()}
            />
        </div>
        <Dialog.Footer class="gap-2">
            <Button variant="outline" onclick={() => { showEditProjectDialog = false; editProjectName = ""; projectToEdit = null; }}>
                {m.header_button_cancel()}
            </Button>
            <Button onclick={handleEditProject} disabled={!editProjectName.trim()}>
                {m.project_save()}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<!-- Remove Project Dialog -->
<Dialog.Root bind:open={showRemoveProjectDialog}>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>{m.project_delete_dialog_title()}</Dialog.Title>
            <Dialog.Description>
                {m.project_delete_dialog_description({ name: projectToRemoveName })}
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer class="gap-2">
            <Button variant="outline" onclick={() => showRemoveProjectDialog = false}>
                {m.header_button_cancel()}
            </Button>
            <Button variant="destructive" onclick={handleRemoveProject}>
                {m.project_delete_confirm()}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
