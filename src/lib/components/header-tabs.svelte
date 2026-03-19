<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { flip } from "svelte/animate";
    import { dndzone } from "svelte-dnd-action";
    import { page } from "$app/state";
    import { resolve } from "$app/paths";
    import { isTauri } from "$lib/utils/environment";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { PlusIcon, XIcon, TableIcon, FileCodeIcon, ActivityIcon, NetworkIcon, BarChart3Icon, LayoutGridIcon, GitBranchIcon, CableIcon, LayoutDashboardIcon } from "@lucide/svelte";
    import { RocketIcon } from "@lucide/svelte";
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import { useShortcuts, findShortcut } from "$lib/shortcuts/index.js";
    import ShortcutKeys from "$lib/components/shortcut-keys.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
    import UnsavedChangesDialog from "$lib/components/unsaved-changes-dialog.svelte";
    import BatchUnsavedDialog from "$lib/components/batch-unsaved-dialog.svelte";
    import SaveQueryDialog from "$lib/components/save-query-dialog.svelte";
    import type { QueryTab, SchemaTab, ExplainTab, ErdTab, StatisticsTab, CanvasTab, VisualizeTab, ConnectionTab, DashboardTab } from "$lib/types";

    const db = useDatabase();
    const shortcuts = useShortcuts();

    // Route-aware: only render on manage page
    const isManagePage = $derived(
        page.url.pathname === resolve("/manage") || page.url.pathname === resolve("/")
    );

    // Track which type of tab is active
    let activeTabType = $derived(db.state.activeView);

    // For editing query tab names
    let editingTabId = $state<string | null>(null);
    let editingTabName = $state("");
    let editingInitialWidth = $state(0);
    let editingFont = $state("");

    const autofocus = () => (el: HTMLInputElement) => {
        el.focus();
        el.select();
    };

    const measureTextWidth = (text: string, font: string) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = font;
        return ctx.measureText(text).width;
    };

    const editingInputWidth = $derived(
        Math.max(editingInitialWidth, measureTextWidth(editingTabName, editingFont) + 22)
    );

    const startEditing = (tabId: string, currentName: string, spanEl: HTMLElement) => {
        editingInitialWidth = spanEl.offsetWidth;
        editingFont = getComputedStyle(spanEl).font;
        editingTabId = tabId;
        editingTabName = currentName;
    };

    const finishEditing = () => {
        if (editingTabId && editingTabName.trim()) {
            db.queryTabs.rename(editingTabId, editingTabName.trim());
        }
        editingTabId = null;
        editingTabName = "";
    };

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            finishEditing();
        } else if (e.key === "Escape") {
            editingTabId = null;
            editingTabName = "";
        }
    };

    const handleQueryTabClick = (tabId: string) => {
        db.queryTabs.setActive(tabId);
        db.ui.setActiveView("query");
    };

    const handleSchemaTabClick = (tabId: string) => {
        db.schemaTabs.setActive(tabId);
        db.ui.setActiveView("schema");
    };

    const handleExplainTabClick = (tabId: string) => {
        db.explainTabs.setActive(tabId);
        db.ui.setActiveView("explain");
    };

    const handleErdTabClick = (tabId: string) => {
        const erdTab = db.state.erdTabs.find(t => t.id === tabId);
        if (erdTab?.connectionId) {
            db.connections.setActive(erdTab.connectionId);
        }
        db.erdTabs.setActive(tabId);
        db.ui.setActiveView("erd");
    };

    const handleStatisticsTabClick = (tabId: string) => {
        const statsTab = db.state.statisticsTabs.find(t => t.id === tabId);
        if (statsTab?.connectionId) {
            db.connections.setActive(statsTab.connectionId);
        }
        db.statisticsTabs.setActive(tabId);
        db.ui.setActiveView("statistics");
    };

    const handleCanvasTabClick = (tabId: string) => {
        const canvasTab = db.state.canvasTabs.find(t => t.id === tabId);
        if (canvasTab?.connectionId) {
            db.connections.setActive(canvasTab.connectionId);
        }
        db.canvasTabs.setActive(tabId);
        db.ui.setActiveView("canvas");
    };

    const handleVisualizeTabClick = (tabId: string) => {
        db.visualizeTabs.setActive(tabId);
        db.ui.setActiveView("visualize");
    };

    const handleConnectionTabClick = (tabId: string) => {
        db.connectionTabs.setActive(tabId);
        db.ui.setActiveView("connection");
    };

    const handleDashboardTabClick = (tabId: string) => {
        db.dashboardTabs.setActive(tabId);
        db.ui.setActiveView("dashboard");
    };

    // Get ordered tabs from db (uses custom order with timestamp fallback)
    const allTabs = $derived.by(() => {
        const ordered = db.tabs.ordered;
        return Array.isArray(ordered) ? [...ordered] : [];
    });

    // Drag and drop configuration
    const flipDurationMs = 150;
    type TabType = 'query' | 'schema' | 'explain' | 'erd' | 'statistics' | 'canvas' | 'visualize' | 'connection' | 'dashboard';
    type DndItem = { id: string; type: TabType; tab: QueryTab | SchemaTab | ExplainTab | ErdTab | StatisticsTab | CanvasTab | VisualizeTab | import('$lib/types').ConnectionTab | DashboardTab };

    // State for dragging
    let draggedItems = $state<DndItem[]>([]);
    let isDragging = $state(false);

    const displayTabs = $derived(isDragging ? draggedItems : allTabs);

    function handleDndConsider(e: CustomEvent<{ items: DndItem[] }>) {
        isDragging = true;
        draggedItems = e.detail.items;
    }

    function handleDndFinalize(e: CustomEvent<{ items: DndItem[] }>) {
        isDragging = false;
        draggedItems = [];
        const newOrder = e.detail.items.map(item => item.id);
        db.tabs.reorder(newOrder);
    }

    const currentTabIndex = $derived(() => {
        if (db.state.activeView === 'query' && db.state.activeQueryTabId) {
            return allTabs.findIndex(t => t.type === 'query' && t.id === db.state.activeQueryTabId);
        }
        if (db.state.activeView === 'schema' && db.state.activeSchemaTabId) {
            return allTabs.findIndex(t => t.type === 'schema' && t.id === db.state.activeSchemaTabId);
        }
        if (db.state.activeView === 'explain' && db.state.activeExplainTabId) {
            return allTabs.findIndex(t => t.type === 'explain' && t.id === db.state.activeExplainTabId);
        }
        if (db.state.activeView === 'erd' && db.state.activeErdTabId) {
            return allTabs.findIndex(t => t.type === 'erd' && t.id === db.state.activeErdTabId);
        }
        if (db.state.activeView === 'statistics' && db.state.activeStatisticsTabId) {
            return allTabs.findIndex(t => t.type === 'statistics' && t.id === db.state.activeStatisticsTabId);
        }
        if (db.state.activeView === 'canvas' && db.state.activeCanvasTabId) {
            return allTabs.findIndex(t => t.type === 'canvas' && t.id === db.state.activeCanvasTabId);
        }
        if (db.state.activeView === 'visualize' && db.state.activeVisualizeTabId) {
            return allTabs.findIndex(t => t.type === 'visualize' && t.id === db.state.activeVisualizeTabId);
        }
        if (db.state.activeView === 'connection' && db.state.activeConnectionTabId) {
            return allTabs.findIndex(t => t.type === 'connection' && t.id === db.state.activeConnectionTabId);
        }
        if (db.state.activeView === 'dashboard' && db.state.activeDashboardTabId) {
            return allTabs.findIndex(t => t.type === 'dashboard' && t.id === db.state.activeDashboardTabId);
        }
        return -1;
    });

    const switchToTab = (index: number) => {
        if (index < 0 || index >= allTabs.length) return;
        const tab = allTabs[index];
        if (tab.type === 'query') {
            handleQueryTabClick(tab.id);
        } else if (tab.type === 'schema') {
            handleSchemaTabClick(tab.id);
        } else if (tab.type === 'explain') {
            handleExplainTabClick(tab.id);
        } else if (tab.type === 'erd') {
            handleErdTabClick(tab.id);
        } else if (tab.type === 'statistics') {
            handleStatisticsTabClick(tab.id);
        } else if (tab.type === 'canvas') {
            handleCanvasTabClick(tab.id);
        } else if (tab.type === 'visualize') {
            handleVisualizeTabClick(tab.id);
        } else if (tab.type === 'connection') {
            db.connectionTabs.setActive(tab.id);
            db.ui.setActiveView('connection');
        } else if (tab.type === 'dashboard') {
            handleDashboardTabClick(tab.id);
        }
    };

    // Unsaved changes dialog state
    let pendingCloseTabId = $state<string | null>(null);
    let showUnsavedDialog = $state(false);
    let showSaveDialogForClose = $state(false);

    // Batch close dialog state
    let pendingBatchCloseTabs = $state<{id: string, type: TabType}[]>([]);
    let unsavedTabsInBatch = $state<string[]>([]);
    let showBatchUnsavedDialog = $state(false);

    const closeTabDirect = (id: string, type: TabType) => {
        if (type === 'query') db.queryTabs.remove(id);
        else if (type === 'schema') db.schemaTabs.remove(id);
        else if (type === 'explain') db.explainTabs.remove(id);
        else if (type === 'erd') db.erdTabs.remove(id);
        else if (type === 'statistics') db.statisticsTabs.remove(id);
        else if (type === 'canvas') db.canvasTabs.remove(id);
        else if (type === 'visualize') db.visualizeTabs.remove(id);
        else if (type === 'connection') db.connectionTabs.remove(id);
        else if (type === 'dashboard') db.dashboardTabs.remove(id);
    };

    const tryCloseQueryTab = (tabId: string) => {
        if (db.queryTabs.hasUnsavedChanges(tabId)) {
            pendingCloseTabId = tabId;
            showUnsavedDialog = true;
        } else {
            db.queryTabs.remove(tabId);
        }
    };

    const handleUnsavedDiscard = () => {
        if (pendingCloseTabId) {
            db.queryTabs.remove(pendingCloseTabId);
            pendingCloseTabId = null;
        }
    };

    const handleUnsavedSave = () => {
        showSaveDialogForClose = true;
    };

    const handleUnsavedCancel = () => {
        pendingCloseTabId = null;
    };

    const handleSaveComplete = () => {
        if (pendingCloseTabId) {
            db.queryTabs.remove(pendingCloseTabId);
            pendingCloseTabId = null;
        }
        showSaveDialogForClose = false;
    };

    const tryBatchClose = (tabsToClose: {id: string, type: TabType}[]) => {
        const unsaved = tabsToClose
            .filter(t => t.type === 'query' && db.queryTabs.hasUnsavedChanges(t.id))
            .map(t => t.id);

        if (unsaved.length > 0) {
            pendingBatchCloseTabs = tabsToClose;
            unsavedTabsInBatch = unsaved;
            showBatchUnsavedDialog = true;
        } else {
            tabsToClose.forEach(t => closeTabDirect(t.id, t.type));
        }
    };

    const handleBatchDiscard = () => {
        pendingBatchCloseTabs.forEach(t => closeTabDirect(t.id, t.type));
        pendingBatchCloseTabs = [];
        unsavedTabsInBatch = [];
    };

    const handleBatchCancel = () => {
        pendingBatchCloseTabs = [];
        unsavedTabsInBatch = [];
    };

    const closeCurrentTab = () => {
        if (db.state.activeView === 'query' && db.state.activeQueryTabId) {
            tryCloseQueryTab(db.state.activeQueryTabId);
        } else if (db.state.activeView === 'schema' && db.state.activeSchemaTabId) {
            db.schemaTabs.remove(db.state.activeSchemaTabId);
        } else if (db.state.activeView === 'explain' && db.state.activeExplainTabId) {
            db.explainTabs.remove(db.state.activeExplainTabId);
        } else if (db.state.activeView === 'erd' && db.state.activeErdTabId) {
            db.erdTabs.remove(db.state.activeErdTabId);
        } else if (db.state.activeView === 'statistics' && db.state.activeStatisticsTabId) {
            db.statisticsTabs.remove(db.state.activeStatisticsTabId);
        } else if (db.state.activeView === 'canvas' && db.state.activeCanvasTabId) {
            db.canvasTabs.remove(db.state.activeCanvasTabId);
        } else if (db.state.activeView === 'visualize' && db.state.activeVisualizeTabId) {
            db.visualizeTabs.remove(db.state.activeVisualizeTabId);
        } else if (db.state.activeView === 'connection' && db.state.activeConnectionTabId) {
            db.connectionTabs.remove(db.state.activeConnectionTabId);
        } else if (db.state.activeView === 'dashboard' && db.state.activeDashboardTabId) {
            db.dashboardTabs.remove(db.state.activeDashboardTabId);
        }
    };

    const closeTab = (id: string, type: TabType) => {
        if (type === 'query') tryCloseQueryTab(id);
        else if (type === 'schema') db.schemaTabs.remove(id);
        else if (type === 'explain') db.explainTabs.remove(id);
        else if (type === 'erd') db.erdTabs.remove(id);
        else if (type === 'statistics') db.statisticsTabs.remove(id);
        else if (type === 'canvas') db.canvasTabs.remove(id);
        else if (type === 'visualize') db.visualizeTabs.remove(id);
        else if (type === 'connection') db.connectionTabs.remove(id);
        else if (type === 'dashboard') db.dashboardTabs.remove(id);
    };

    const closeOtherTabs = (id: string) => {
        const tabsToClose = allTabs.filter(t => t.id !== id);
        tryBatchClose(tabsToClose);
    };

    const closeTabsToRight = (id: string) => {
        const idx = allTabs.findIndex(t => t.id === id);
        tryBatchClose(allTabs.slice(idx + 1));
    };

    const closeTabsToLeft = (id: string) => {
        const idx = allTabs.findIndex(t => t.id === id);
        tryBatchClose(allTabs.slice(0, idx));
    };

    const closeAllTabs = () => {
        tryBatchClose([...allTabs]);
    };

    // Register keyboard shortcuts
    onMount(() => {
        shortcuts.registerHandler('newTab', () => {
            db.queryTabs.add();
            db.ui.setActiveView("query");
        });
        shortcuts.registerHandler('closeTab', closeCurrentTab);
        shortcuts.registerHandler('nextTab', () => {
            const idx = currentTabIndex();
            switchToTab((idx + 1) % allTabs.length);
        });
        shortcuts.registerHandler('previousTab', () => {
            const idx = currentTabIndex();
            switchToTab((idx - 1 + allTabs.length) % allTabs.length);
        });

        for (let i = 1; i <= 9; i++) {
            shortcuts.registerHandler(`goToTab${i}`, () => switchToTab(i - 1));
        }
    });

    onDestroy(() => {
        shortcuts.unregisterHandler('newTab');
        shortcuts.unregisterHandler('closeTab');
        shortcuts.unregisterHandler('nextTab');
        shortcuts.unregisterHandler('previousTab');
        for (let i = 1; i <= 9; i++) {
            shortcuts.unregisterHandler(`goToTab${i}`);
        }
    });

    // Listen for "Close Tab" menu event from Tauri
    $effect(() => {
        if (!isTauri()) return;

        let cleanup: (() => void) | undefined;

        import("@tauri-apps/api/event").then(({ listen }) => {
            listen("menu-close-tab", () => {
                closeCurrentTab();
            }).then((unlisten) => {
                cleanup = unlisten;
            });
        });

        return () => {
            cleanup?.();
        };
    });
</script>

{#if isManagePage}
    {#if db.state.connectionsLoading || db.state.projectsLoading}
        <!-- Loading state - show nothing -->
    {:else if db.state.activeConnection}
        <!-- Regular tabs -->
        <div class="flex items-center gap-1 h-full min-w-0">
            <div class="flex-1 overflow-x-auto overflow-y-hidden min-w-0 scrollbar-hide">
                <div
                    class="flex items-center gap-2 w-max"
                    use:dndzone={{
                        items: displayTabs,
                        flipDurationMs,
                        type: 'tabs',
                        dropTargetStyle: {},
                        dragDisabled: editingTabId !== null
                    }}
                    onconsider={handleDndConsider}
                    onfinalize={handleDndFinalize}
                >
                    {#each displayTabs as { id, type, tab } (id)}
                        <div animate:flip={{ duration: flipDurationMs }}>
                        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                        {#if type === 'query'}
                            {@const queryTab = tab as import('$lib/types').QueryTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "query" && db.state.activeQueryTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleQueryTabClick(id)}
                                    >
                                        <FileCodeIcon class="size-3 text-muted-foreground" />
                                        {#if editingTabId === id}
                                            <input
                                                bind:value={editingTabName}
                                                class="h-5 px-1 text-xs pr-4 outline-none ring-0"
                                                style="width: {editingInputWidth}px"
                                                onkeydown={handleKeydown}
                                                onblur={finishEditing}
                                                onclick={(e) => e.stopPropagation()}
                                                {@attach autofocus()}
                                            />
                                        {:else}
                                            <span
                                                class="pr-4"
                                                ondblclick={(e) => {
                                                    e.stopPropagation();
                                                    startEditing(id, queryTab.name, e.currentTarget);
                                                }}
                                            >
                                                {queryTab.name}{db.queryTabs.hasUnsavedChanges(id) ? " *" : ""}
                                            </span>
                                        {/if}
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                tryCloseQueryTab(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => tryCloseQueryTab(id)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'schema'}
                            {@const schemaTab = tab as import('$lib/types').SchemaTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "schema" && db.state.activeSchemaTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleSchemaTabClick(id)}
                                    >
                                        <TableIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{schemaTab.table.schema}.{schemaTab.table.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.schemaTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'explain'}
                            {@const explainTab = tab as import('$lib/types').ExplainTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "explain" && db.state.activeExplainTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleExplainTabClick(id)}
                                    >
                                        <ActivityIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{explainTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.explainTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'erd'}
                            {@const erdTab = tab as import('$lib/types').ErdTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "erd" && db.state.activeErdTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleErdTabClick(id)}
                                    >
                                        <NetworkIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{erdTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.erdTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'statistics'}
                            {@const statsTab = tab as import('$lib/types').StatisticsTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "statistics" && db.state.activeStatisticsTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleStatisticsTabClick(id)}
                                    >
                                        <BarChart3Icon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{statsTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.statisticsTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'canvas'}
                            {@const canvasTab = tab as import('$lib/types').CanvasTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "canvas" && db.state.activeCanvasTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleCanvasTabClick(id)}
                                    >
                                        <LayoutGridIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{canvasTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.canvasTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'visualize'}
                            {@const visualizeTab = tab as import('$lib/types').VisualizeTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "visualize" && db.state.activeVisualizeTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleVisualizeTabClick(id)}
                                    >
                                        <GitBranchIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{visualizeTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.visualizeTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'connection'}
                            {@const connectionTab = tab as ConnectionTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "connection" && db.state.activeConnectionTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleConnectionTabClick(id)}
                                    >
                                        <CableIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{connectionTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.connectionTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {:else if type === 'dashboard'}
                            {@const dashboardTab = tab as DashboardTab}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger>
                                    <div
                                        class={[
                                            "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors",
                                            activeTabType === "dashboard" && db.state.activeDashboardTabId === id
                                                ? "bg-muted shadow-sm"
                                                : "hover:bg-muted/50",
                                        ]}
                                        onclick={() => handleDashboardTabClick(id)}
                                    >
                                        <LayoutDashboardIcon class="size-3 text-muted-foreground" />
                                        <span class="pr-4">{dashboardTab.name}</span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                db.dashboardTabs.remove(id);
                                            }}
                                        >
                                            <XIcon />
                                        </Button>
                                    </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Content class="w-40">
                                        <ContextMenu.Item onclick={() => closeTab(id, type)}>Close</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeOtherTabs(id)}>Close Others</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToRight(id)}>Close Right</ContextMenu.Item>
                                        <ContextMenu.Item onclick={() => closeTabsToLeft(id)}>Close Left</ContextMenu.Item>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item onclick={closeAllTabs}>Close All</ContextMenu.Item>
                                    </ContextMenu.Content>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        {/if}
                        </div>
                    {/each}
                </div>
            </div>

            <!-- Add new query tab button -->
            <Tooltip.Root>
                <Tooltip.Trigger>
                    <Button
                        size="icon"
                        variant="ghost"
                        class="size-7 shrink-0 [&_svg:not([class*='size-'])]:size-4"
                        onclick={() => {
                            db.queryTabs.add();
                            db.ui.setActiveView("query");
                        }}
                    >
                        <PlusIcon />
                    </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom">
                    <span class="flex items-center gap-2">
                        New Tab
                        {#if findShortcut('newTab')}
                            <ShortcutKeys keys={findShortcut('newTab')!.keys} />
                        {/if}
                    </span>
                </Tooltip.Content>
            </Tooltip.Root>
        </div>
    {:else}
        <!-- No active connection - show starter tabs + any connection tabs -->
        <div class="flex items-center gap-1 h-full min-w-0">
            <div class="flex-1 overflow-x-auto overflow-y-hidden min-w-0 scrollbar-hide">
                <div class="flex items-center gap-1 w-max">
                    {#each db.state.starterTabs as starterTab (starterTab.id)}
                        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                        <div
                            class={[
                                "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors cursor-pointer",
                                db.state.activeView !== "connection" && db.state.activeStarterTabId === starterTab.id
                                    ? "bg-muted shadow-sm"
                                    : "hover:bg-muted/50",
                            ]}
                            onclick={() => {
                                db.starterTabs.setActive(starterTab.id);
                                db.ui.setActiveView("query");
                            }}
                        >
                            <RocketIcon class="size-3 text-muted-foreground" />
                            <span class="pr-4">{starterTab.name}</span>
                            {#if starterTab.closable}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        db.starterTabs.remove(starterTab.id);
                                    }}
                                >
                                    <XIcon />
                                </Button>
                            {/if}
                        </div>
                    {/each}
                    {#each db.state.connectionTabs as connectionTab (connectionTab.id)}
                        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                        <div
                            class={[
                                "relative group shrink-0 flex items-center gap-2 px-3 h-7 text-xs rounded-md transition-colors cursor-pointer",
                                db.state.activeView === "connection" && db.state.activeConnectionTabId === connectionTab.id
                                    ? "bg-muted shadow-sm"
                                    : "hover:bg-muted/50",
                            ]}
                            onclick={() => handleConnectionTabClick(connectionTab.id)}
                        >
                            <CableIcon class="size-3 text-muted-foreground" />
                            <span class="pr-4">{connectionTab.name}</span>
                            <Button
                                size="icon"
                                variant="ghost"
                                class="absolute right-0 top-1/2 -translate-y-1/2 size-5 opacity-0 group-hover:opacity-100 transition-opacity [&_svg:not([class*='size-'])]:size-3"
                                onclick={(e) => {
                                    e.stopPropagation();
                                    db.connectionTabs.remove(connectionTab.id);
                                }}
                            >
                                <XIcon />
                            </Button>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
{/if}

<UnsavedChangesDialog
    bind:open={showUnsavedDialog}
    onDiscard={handleUnsavedDiscard}
    onSave={handleUnsavedSave}
    onCancel={handleUnsavedCancel}
/>

{#if pendingCloseTabId}
    {@const pendingTab = db.state.queryTabs.find(t => t.id === pendingCloseTabId)}
    {#if pendingTab}
        <SaveQueryDialog
            bind:open={showSaveDialogForClose}
            query={pendingTab.query}
            tabId={pendingCloseTabId}
            onSaveComplete={handleSaveComplete}
        />
    {/if}
{/if}

<BatchUnsavedDialog
    bind:open={showBatchUnsavedDialog}
    unsavedCount={unsavedTabsInBatch.length}
    onDiscardAll={handleBatchDiscard}
    onCancel={handleBatchCancel}
/>
