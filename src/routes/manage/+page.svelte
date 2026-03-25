<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { SidebarInset } from "$lib/components/ui/sidebar";
    import SidebarLeft from "$lib/components/sidebar-left.svelte";
    import AIAssistant from "$lib/components/ai-assistant.svelte";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import { useShortcuts } from "$lib/shortcuts/index.js";
    import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
    import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
    import PaneContainer from "$lib/components/pane-container.svelte";
    import ProjectSettingsDialog from "$lib/components/project-settings-dialog.svelte";
    import { aiSettingsStore } from "$lib/stores/ai-settings.svelte.js";

    const db = useDatabase();
    const shortcuts = useShortcuts();
    const sidebar = useSidebar();

    // Project settings dialog state (opened via Cmd+;)
    let showProjectSettings = $state(false);
    let projectSettingsId = $state<string | null>(null);

    // Register keyboard shortcuts (settings + sidebar only; tab shortcuts are in header-tabs)
    onMount(() => {
        shortcuts.registerHandler('openSettings', () => {
            settingsDialogStore.open();
        });

        shortcuts.registerHandler('openProjectSettings', () => {
            if (db.state.activeProjectId) {
                projectSettingsId = db.state.activeProjectId;
                showProjectSettings = true;
            }
        });

        shortcuts.registerHandler('toggleSidebar', () => {
            sidebar.toggle();
        });
    });

    onDestroy(() => {
        shortcuts.unregisterHandler('openSettings');
        shortcuts.unregisterHandler('openProjectSettings');
        shortcuts.unregisterHandler('toggleSidebar');
    });
</script>

{#if !db.state.isDashboardFullscreen}
    <SidebarLeft />
{/if}

<SidebarInset class="flex flex-col h-full overflow-hidden min-w-0">
    {#if db.state.connectionsLoading || db.state.projectsLoading}
        <!-- Loading state - show nothing to prevent flash -->
    {:else}
        <div class="flex-1 min-h-0 flex flex-col">
            <PaneContainer />
        </div>
    {/if}
</SidebarInset>

{#if !db.state.isDashboardFullscreen && aiSettingsStore.settings.enabled}
    <Sidebar.Provider class="contents" open={db.state.isAIOpen} onOpenChange={(open) => { if (open !== db.state.isAIOpen) db.ui.toggleAI(); }} style="--sidebar-width: 24rem">
        <Sidebar.Root side="right" collapsible="offcanvas" class="top-(--header-height) h-[calc(100svh-var(--header-height))]">
            <AIAssistant />
        </Sidebar.Root>
    </Sidebar.Provider>
{/if}

{#if projectSettingsId}
    <ProjectSettingsDialog projectId={projectSettingsId} bind:open={showProjectSettings} />
{/if}
