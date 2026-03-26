<script lang="ts">
    import type { Pane } from "$lib/types";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import HeaderTabs from "$lib/components/header-tabs.svelte";
    import QueryEditor from "$lib/components/query-editor.svelte";
    import TableViewer from "$lib/components/table-viewer.svelte";
    import ExplainViewer from "$lib/components/explain-viewer.svelte";
    import ErdViewer from "$lib/components/erd-viewer.svelte";
    import GettingStartedContent from "$lib/components/starter-tabs/getting-started-content.svelte";
    import StarterTabContent from "$lib/components/starter-tabs/starter-tab-content.svelte";

    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { StatisticsDashboard } from "$lib/components/statistics";
    import WorkflowView from "$lib/components/workflow/workflow-view.svelte";
    import QueryVisualViewer from "$lib/components/query-visual-viewer.svelte";
    import ConnectionTabView from "$lib/components/connection-tab-view.svelte";
    import SettingsTabView from "$lib/components/settings-tab-view.svelte";
    import ProjectSettingsTabView from "$lib/components/project-settings-tab-view.svelte";
    import { DashboardView } from "$lib/components/dashboard";
    import DragSplitOverlay from "$lib/components/drag-split-overlay.svelte";
    import { usePaneDragState } from "$lib/components/pane-drag-context.svelte.js";

    let { pane, isActive, totalPanes = 1 }: { pane: Pane; isActive: boolean; totalPanes?: number } = $props();

    const db = useDatabase();
    const dragState = usePaneDragState();

    // Register this pane's DOM element for split-zone hit testing
    let paneEl = $state<HTMLElement | null>(null);
    $effect(() => {
        if (paneEl && dragState) {
            const id = pane.id;
            dragState.registerPane(id, paneEl);
            return () => {
                dragState.unregisterPane(id);
            };
        }
    });

    // Determine active view type for this pane's active tab
    const paneViewType = $derived(pane.activeTabId ? db.panes.getTabViewType(pane.activeTabId) : null);

    // Find specific tab objects for prop-based components
    const activeConnectionTab = $derived(
        paneViewType === 'connection' && pane.activeTabId
            ? db.state.connectionTabs.find(t => t.id === pane.activeTabId) ?? null
            : null
    );
    const activeStatisticsTab = $derived(
        paneViewType === 'statistics' && pane.activeTabId
            ? db.state.statisticsTabs.find(t => t.id === pane.activeTabId) ?? null
            : null
    );
    const activeStarterTab = $derived(
        paneViewType === 'starter' && pane.activeTabId
            ? db.state.starterTabs.find(t => t.id === pane.activeTabId) ?? null
            : null
    );
    const activeSettingsTab = $derived(
        paneViewType === 'settings' && pane.activeTabId
            ? db.state.settingsTabs.find(t => t.id === pane.activeTabId) ?? null
            : null
    );

    const handlePaneClick = () => {
        if (!isActive) {
            db.panes.setActivePane(pane.id);
        }
    };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
    bind:this={paneEl}
    class={[
        "flex flex-col h-full min-w-0 relative",
        totalPanes > 1 && isActive && "ring-1 ring-primary/30",
    ]}
    onclick={handlePaneClick}
>
    {#if dragState}
        <DragSplitOverlay paneId={pane.id} {dragState} />
    {/if}
    {#if !db.state.isDashboardFullscreen}
        <div class="h-8 flex items-center border-b shrink-0 pl-2">
            <HeaderTabs paneId={pane.id} {pane} />
        </div>
    {/if}

    {#if pane.tabIds.length === 0}
        <div class="flex-1 min-h-0 flex flex-col">
            {#if totalPanes <= 1}
                <GettingStartedContent />
            {/if}
        </div>
    {:else if paneViewType === "starter" && activeStarterTab}
        <div class="flex-1 min-h-0 flex flex-col">
            <StarterTabContent tab={activeStarterTab} />
        </div>
    {:else if paneViewType === "connection" && activeConnectionTab}
        <div class="flex-1 min-h-0 flex flex-col">
            {#key activeConnectionTab.id}
                <ConnectionTabView tab={activeConnectionTab} />
            {/key}
        </div>
    {:else if paneViewType === "settings" && activeSettingsTab}
        <div class="flex-1 min-h-0 flex flex-col">
            {#key activeSettingsTab.id}
                {#if activeSettingsTab.kind === "project"}
                    <ProjectSettingsTabView tab={activeSettingsTab} />
                {:else}
                    <SettingsTabView tab={activeSettingsTab} />
                {/if}
            {/key}
        </div>
    {:else if paneViewType === "query" && pane.activeTabId}
        <div class="flex-1 min-h-0 flex flex-col">
            {#key pane.activeTabId}
                <QueryEditor tabId={pane.activeTabId} />
            {/key}
        </div>
    {:else if paneViewType === "dashboard" && pane.activeTabId}
        <div class="flex-1 min-h-0 flex flex-col">
            {#key pane.activeTabId}
                <DashboardView tabId={pane.activeTabId} />
            {/key}
        </div>
    {:else if db.state.activeConnection}
        <div class="flex-1 min-h-0 flex flex-col">
            {#if paneViewType === "schema" && pane.activeTabId}
                <ScrollArea orientation="both" class="h-full">
                    {#key pane.activeTabId}
                        <TableViewer tabId={pane.activeTabId} />
                    {/key}
                </ScrollArea>
            {:else if paneViewType === "explain" && pane.activeTabId}
                {#key pane.activeTabId}
                    <ExplainViewer tabId={pane.activeTabId} />
                {/key}
            {:else if paneViewType === "erd"}
                <ErdViewer />
            {:else if paneViewType === "statistics" && activeStatisticsTab}
                <StatisticsDashboard tab={activeStatisticsTab} />
            {:else if paneViewType === "workflow"}
                <WorkflowView />
            {:else if paneViewType === "visualize" && pane.activeTabId}
                {#key pane.activeTabId}
                    <QueryVisualViewer tabId={pane.activeTabId} />
                {/key}
            {:else}
                <GettingStartedContent />
            {/if}
        </div>
    {:else}
        <div class="flex-1 min-h-0 flex flex-col">
            <GettingStartedContent />
        </div>
    {/if}
</div>
