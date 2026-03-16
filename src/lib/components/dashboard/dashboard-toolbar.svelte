<script lang="ts">
	import type { Dashboard } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		PlusIcon,
		RefreshCwIcon,
		Loader2Icon,
		MaximizeIcon,
		MinimizeIcon,
	} from '@lucide/svelte';
	import { useDatabase } from '$lib/hooks/database.svelte.js';

	interface Props {
		dashboard: Dashboard;
		isFullscreen?: boolean;
		onAddWidget: () => void;
		onRefreshAll: () => void;
		onToggleFullscreen?: () => void;
	}

	let {
		dashboard,
		isFullscreen = false,
		onAddWidget,
		onRefreshAll,
		onToggleFullscreen,
	}: Props = $props();

	const db = useDatabase();

	let editingName = $state(false);
	let nameInput = $state('');

	const isAnyWidgetLoading = $derived(
		dashboard.widgets.some((w) => w.isLoading)
	);

	function saveName() {
		const trimmed = nameInput.trim();
		if (trimmed && trimmed !== dashboard.name) {
			db.dashboards.renameDashboard(dashboard.id, trimmed);
			const tab = db.state.dashboardTabs.find(
				(t) => t.dashboardId === dashboard.id
			);
			if (tab) {
				db.dashboardTabs.rename(tab.id, trimmed);
			}
		}
		editingName = false;
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveName();
		else if (e.key === 'Escape') {
			nameInput = dashboard.name;
			editingName = false;
		}
	}
</script>

<div class="flex items-center justify-between border-b px-4 py-2">
	<div class="flex items-center gap-2">
		{#if editingName}
			<Input
				class="h-7 w-48 text-sm"
				bind:value={nameInput}
				onblur={saveName}
				onkeydown={handleNameKeydown}
			/>
		{:else}
			<h2
				class="font-medium cursor-pointer hover:text-foreground/80"
				ondblclick={() => {
					nameInput = dashboard.name;
					editingName = true;
				}}
			>
				{dashboard.name}
			</h2>
		{/if}
		<span class="text-xs text-muted-foreground">
			{dashboard.widgets.length} widget{dashboard.widgets.length !== 1 ? 's' : ''}
		</span>
	</div>

	<div class="flex items-center gap-1">
		{#if !isFullscreen}
			<Button variant="outline" size="sm" onclick={onAddWidget}>
				<PlusIcon class="mr-1 size-3.5" />
				Add Widget
			</Button>
		{/if}

		<Button
			variant="outline"
			size="sm"
			onclick={onRefreshAll}
			disabled={isAnyWidgetLoading}
		>
			{#if isAnyWidgetLoading}
				<Loader2Icon class="mr-1 size-3.5 animate-spin" />
			{:else}
				<RefreshCwIcon class="mr-1 size-3.5" />
			{/if}
			Refresh
		</Button>

		{#if onToggleFullscreen}
			<Button variant="ghost" size="icon" class="size-7" onclick={onToggleFullscreen}>
				{#if isFullscreen}
					<MinimizeIcon class="size-3.5" />
				{:else}
					<MaximizeIcon class="size-3.5" />
				{/if}
			</Button>
		{/if}
	</div>
</div>
