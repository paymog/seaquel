<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { SidebarInset } from "$lib/components/ui/sidebar";
    import SidebarLeft from "$lib/components/sidebar-left.svelte";
    import QueryEditor from "$lib/components/query-editor.svelte";
    import TableViewer from "$lib/components/table-viewer.svelte";
    import ExplainViewer from "$lib/components/explain-viewer.svelte";
    import ErdViewer from "$lib/components/erd-viewer.svelte";
    import AIAssistant from "$lib/components/ai-assistant.svelte";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import StarterTabContent from "$lib/components/starter-tabs/starter-tab-content.svelte";
    import GettingStartedContent from "$lib/components/starter-tabs/getting-started-content.svelte";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import { useShortcuts } from "$lib/shortcuts/index.js";
    import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
    import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
    import { StatisticsDashboard } from "$lib/components/statistics";
    import WorkflowView from "$lib/components/workflow/workflow-view.svelte";
    import QueryVisualViewer from "$lib/components/query-visual-viewer.svelte";
    import ConnectionTabView from "$lib/components/connection-tab-view.svelte";
    import { DashboardView } from "$lib/components/dashboard";
    import HeaderTabs from "$lib/components/header-tabs.svelte";
    import ProjectSettingsDialog from "$lib/components/project-settings-dialog.svelte";

    const db = useDatabase();
    const shortcuts = useShortcuts();
    const sidebar = useSidebar();

    // Track which type of tab is active
    let activeTabType = $derived(db.state.activeView);

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
    {#if !db.state.isDashboardFullscreen}
        <div class="h-8 flex items-center border-b shrink-0 pl-2">
            <HeaderTabs />
        </div>
    {/if}
    {#if db.state.connectionsLoading || db.state.projectsLoading}
        <!-- Loading state - show nothing to prevent flash -->
    {:else if activeTabType === "connection" && db.state.activeConnectionTab}
        <!-- Connection tab takes priority (adding/editing connections) -->
        <div class="flex-1 min-h-0 flex flex-col">
            {#key db.state.activeConnectionTab.id}
                <ConnectionTabView tab={db.state.activeConnectionTab} />
            {/key}
        </div>
    {:else if db.state.projectConnections.length === 0}
        <!-- New project with no connections - show starter tab content -->
        <div class="flex-1 min-h-0 flex flex-col">
            {#if db.state.activeStarterTab}
                <StarterTabContent tab={db.state.activeStarterTab} />
            {:else}
                <GettingStartedContent />
            {/if}
        </div>
    {:else if activeTabType === "query" && db.state.activeQueryTab}
        <div class="flex-1 min-h-0 flex flex-col">
            <QueryEditor />
        </div>
    {:else if activeTabType === "dashboard" && db.state.activeDashboardTab}
        <div class="flex-1 min-h-0 flex flex-col">
            <DashboardView />
        </div>
    {:else if db.state.activeConnection}
        <!-- Views that require an active connection -->
        <div class="flex-1 min-h-0 flex flex-col">
            {#if activeTabType === "schema"}
                <ScrollArea orientation="both" class="h-full">
                    <TableViewer />
                </ScrollArea>
            {:else if activeTabType === "explain"}
                <ExplainViewer />
            {:else if activeTabType === "erd"}
                <ErdViewer />
            {:else if activeTabType === "statistics"}
                {#if db.state.activeStatisticsTab}
                    <StatisticsDashboard tab={db.state.activeStatisticsTab} />
                {/if}
            {:else if activeTabType === "workflow"}
                {#if db.state.activeWorkflowTab}
                    <WorkflowView />
                {/if}
            {:else if activeTabType === "visualize"}
                <QueryVisualViewer />
            {:else}
                <GettingStartedContent />
            {/if}
        </div>
    {:else}
        <!-- Project has connections but no open tabs -->
        <div class="flex-1 min-h-0 flex flex-col">
            <GettingStartedContent />
        </div>
    {/if}
</SidebarInset>

{#if !db.state.isDashboardFullscreen}
    <Sidebar.Provider class="contents" open={db.state.isAIOpen} onOpenChange={(open) => { if (open !== db.state.isAIOpen) db.ui.toggleAI(); }} style="--sidebar-width: 24rem">
        <Sidebar.Root side="right" collapsible="offcanvas" class="top-(--header-height) h-[calc(100svh-var(--header-height))]">
            <AIAssistant />
        </Sidebar.Root>
    </Sidebar.Provider>
{/if}

{#if projectSettingsId}
    <ProjectSettingsDialog projectId={projectSettingsId} bind:open={showProjectSettings} />
{/if}
