<script lang="ts">
	import type { DashboardWidget } from '$lib/types';
	import { useDatabase } from '$lib/hooks/database.svelte.js';
	import DashboardToolbar from './dashboard-toolbar.svelte';
	import DashboardCanvas from './dashboard-canvas.svelte';
	import DashboardWidgetEditor from './dashboard-widget-editor.svelte';
	import { Loader2Icon } from '@lucide/svelte';
	import { ChartBarIcon, GaugeIcon, TypeIcon } from '@lucide/svelte';
	import { isTauri } from '$lib/utils/environment';

	const db = useDatabase();

	const tab = $derived(db.state.activeDashboardTab);

	const dashboard = $derived(
		tab ? db.dashboards.getDashboard(tab.dashboardId) : undefined
	);

	let widgetEditorOpen = $state(false);
	let editingWidget = $state<DashboardWidget | null>(null);
	let pendingWidget = $state<DashboardWidget | null>(null);
	const isFullscreen = $derived(db.state.isDashboardFullscreen);

	async function getAppWindow() {
		if (!isTauri()) return null;
		const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
		return getCurrentWebviewWindow();
	}

	// Context menu state
	let contextMenuOpen = $state(false);
	let contextMenuPosition = $state({ x: 0, y: 0 });
	let contextMenuCanvasPosition = $state({ x: 0, y: 0 });

	// Auto-create dashboard for new tabs without a dashboardId
	$effect(() => {
		if (tab && !tab.dashboardId) {
			void createDashboardForTab();
		}
	});

	async function createDashboardForTab() {
		if (!tab) return;
		const newDashboard = await db.dashboards.createDashboard(tab.name);
		if (newDashboard) {
			db.dashboardTabs.setDashboardId(tab.id, newDashboard.id);
		}
	}

	function createWidgetAtPosition(
		position: { x: number; y: number },
		widgetType: 'chart' | 'kpi' | 'text' = 'chart',
	): DashboardWidget {
		const defaultWidth = 400;
		const defaultHeight = 300;
		return {
			id: `widget-${Date.now()}`,
			title: 'New Widget',
			x: position.x - defaultWidth / 2,
			y: position.y - defaultHeight / 2,
			width: defaultWidth,
			height: defaultHeight,
			querySource: 'custom',
			query: '',
			widgetType,
		};
	}

	function openEditorForNewWidget(widget: DashboardWidget) {
		editingWidget = null;
		pendingWidget = widget;
		widgetEditorOpen = true;
	}

	function handleAddWidget() {
		if (!dashboard) return;

		// Place widget at viewport center
		const vp = dashboard.viewport;
		const centerX = (-vp.x + 400) / vp.zoom;
		const centerY = (-vp.y + 300) / vp.zoom;

		openEditorForNewWidget(createWidgetAtPosition({ x: centerX, y: centerY }));
	}

	function handleAddWidgetAt(position: { x: number; y: number }) {
		openEditorForNewWidget(createWidgetAtPosition(position));
	}

	function handleCanvasContextMenu(event: MouseEvent, canvasPosition: { x: number; y: number }) {
		contextMenuPosition = { x: event.clientX, y: event.clientY };
		contextMenuCanvasPosition = canvasPosition;
		contextMenuOpen = true;
	}

	function handleContextMenuAdd(widgetType: 'chart' | 'kpi' | 'text') {
		openEditorForNewWidget(createWidgetAtPosition(contextMenuCanvasPosition, widgetType));
		contextMenuOpen = false;
	}

	function handleWindowClick() {
		if (contextMenuOpen) contextMenuOpen = false;
	}

	function handleEditWidget(widget: DashboardWidget) {
		editingWidget = widget;
		pendingWidget = null;
		widgetEditorOpen = true;
	}

	function handleRefreshAll() {
		if (!dashboard) return;
		db.dashboards.executeAllWidgets(dashboard.id);
	}

	function handleWidgetSave(widget: DashboardWidget) {
		if (!dashboard) return;

		if (editingWidget) {
			db.dashboards.updateWidget(dashboard.id, editingWidget.id, widget);
			db.dashboards.executeWidget(dashboard.id, editingWidget.id);
		} else {
			db.dashboards.addWidget(dashboard.id, widget);
			db.dashboards.executeWidget(dashboard.id, widget.id);
		}

		if (widget.autoRefreshSeconds && widget.autoRefreshSeconds > 0) {
			db.dashboards.startAutoRefresh(dashboard.id, widget.id);
		}

		widgetEditorOpen = false;
		editingWidget = null;
		pendingWidget = null;
	}

	function handleWidgetEditorClose() {
		widgetEditorOpen = false;
		editingWidget = null;
		pendingWidget = null;
	}

	async function handleToggleFullscreen() {
		const appWindow = await getAppWindow();
		if (!appWindow) return;
		const newState = !isFullscreen;
		await appWindow.setFullscreen(newState);
		db.state.isDashboardFullscreen = newState;
	}

	async function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isFullscreen) {
			const appWindow = await getAppWindow();
			if (!appWindow) return;
			await appWindow.setFullscreen(false);
			db.state.isDashboardFullscreen = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="flex h-full flex-col overflow-hidden">
	{#if !tab}
		<div class="flex h-full items-center justify-center text-muted-foreground">
			No dashboard selected
		</div>
	{:else if !dashboard}
		<div class="flex h-full items-center justify-center">
			<Loader2Icon class="size-6 animate-spin text-muted-foreground" />
		</div>
	{:else}
		<DashboardToolbar
			{dashboard}
			{isFullscreen}
			onAddWidget={handleAddWidget}
			onRefreshAll={handleRefreshAll}
			onToggleFullscreen={handleToggleFullscreen}
		/>

		<div class="flex flex-1 min-h-0 overflow-hidden">
			<DashboardCanvas
				{dashboard}
				editingWidgetId={editingWidget?.id}
				onEditWidget={handleEditWidget}
				onAddWidgetAt={handleAddWidgetAt}
				onContextMenu={handleCanvasContextMenu}
			/>

			<!-- Widget editor sidebar -->
			<DashboardWidgetEditor
				open={widgetEditorOpen}
				widget={editingWidget}
				dashboardId={dashboard.id}
				initialWidget={pendingWidget}
				onClose={handleWidgetEditorClose}
				onSave={handleWidgetSave}
			/>
		</div>
	{/if}
</div>

{#if contextMenuOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
		onclick={(e: MouseEvent) => e.stopPropagation()}
	>
		<button
			class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={() => handleContextMenuAdd('chart')}
		>
			<ChartBarIcon class="mr-2 size-4" />
			Add Chart
		</button>
		<button
			class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={() => handleContextMenuAdd('kpi')}
		>
			<GaugeIcon class="mr-2 size-4" />
			Add KPI
		</button>
		<button
			class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={() => handleContextMenuAdd('text')}
		>
			<TypeIcon class="mr-2 size-4" />
			Add Text
		</button>
	</div>
{/if}
