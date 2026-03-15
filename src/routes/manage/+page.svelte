<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { SidebarInset } from "$lib/components/ui/sidebar";
    import SidebarLeft from "$lib/components/sidebar-left.svelte";
    import QueryEditor from "$lib/components/query-editor.svelte";
    import TableViewer from "$lib/components/table-viewer.svelte";
    import ExplainViewer from "$lib/components/explain-viewer.svelte";
    import ErdViewer from "$lib/components/erd-viewer.svelte";
    import AIAssistant from "$lib/components/ai-assistant.svelte";
    import StarterTabContent from "$lib/components/starter-tabs/starter-tab-content.svelte";
    import GettingStartedContent from "$lib/components/starter-tabs/getting-started-content.svelte";
    import NoTabsEmptyState from "$lib/components/starter-tabs/no-tabs-empty-state.svelte";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import { useShortcuts } from "$lib/shortcuts/index.js";
    import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
    import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
    import { StatisticsDashboard } from "$lib/components/statistics";
    import CanvasView from "$lib/components/canvas/canvas-view.svelte";
    import QueryVisualViewer from "$lib/components/query-visual-viewer.svelte";
    import HeaderTabs from "$lib/components/header-tabs.svelte";

    const db = useDatabase();
    const shortcuts = useShortcuts();
    const sidebar = useSidebar();

    // Track which type of tab is active
    let activeTabType = $derived(db.state.activeView);

    // Register keyboard shortcuts (settings + sidebar only; tab shortcuts are in header-tabs)
    onMount(() => {
        shortcuts.registerHandler('openSettings', () => {
            settingsDialogStore.open();
        });

        shortcuts.registerHandler('toggleSidebar', () => {
            sidebar.toggle();
        });
    });

    onDestroy(() => {
        shortcuts.unregisterHandler('openSettings');
        shortcuts.unregisterHandler('toggleSidebar');
    });
</script>

<SidebarLeft />

<SidebarInset class="flex flex-col h-full overflow-hidden">
    <div class="h-8 flex items-center border-b shrink-0 pl-2">
        <HeaderTabs />
    </div>
    {#if db.state.connectionsLoading || db.state.projectsLoading}
        <!-- Loading state - show nothing to prevent flash -->
    {:else if db.state.activeConnection}
        <!-- Content Area -->
        <div class="flex-1 min-h-0 flex flex-col">
            {#if activeTabType === "query"}
                <QueryEditor />
            {:else if activeTabType === "schema"}
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
            {:else if activeTabType === "canvas"}
                {#if db.state.activeCanvasTab}
                    <CanvasView />
                {/if}
            {:else if activeTabType === "visualize"}
                <QueryVisualViewer />
            {/if}
        </div>
    {:else}
        <!-- Starter Tab Content Area -->
        <div class="flex-1 min-h-0 flex flex-col">
            {#if db.state.activeStarterTab}
                <StarterTabContent tab={db.state.activeStarterTab} />
            {:else if db.state.projectConnections.length === 0}
                <GettingStartedContent />
            {:else}
                <NoTabsEmptyState />
            {/if}
        </div>
    {/if}
</SidebarInset>

<AIAssistant />
