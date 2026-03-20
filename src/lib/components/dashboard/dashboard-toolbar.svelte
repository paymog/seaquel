<script lang="ts">
	import type { Dashboard } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import ConnectionSelector from '$lib/components/connection-selector.svelte';
	import {
		PlusIcon,
		RefreshCwIcon,
		Loader2Icon,
		MaximizeIcon,
		MinimizeIcon,
	} from '@lucide/svelte';

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

	const isAnyWidgetLoading = $derived(
		dashboard.widgets.some((w) => w.isLoading)
	);
</script>

<div class="flex items-center justify-between border-b bg-muted/30 px-2 py-2">
	<div class="flex items-center gap-2">
	    <ConnectionSelector />
		<span class="text-xs text-muted-foreground">
			{dashboard.widgets.length} widget{dashboard.widgets.length !== 1 ? 's' : ''}
		</span>
	</div>

	<div class="flex items-center gap-1">
		{#if !isFullscreen}
			<Button variant="outline" size="sm" class="h-7" onclick={onAddWidget}>
				<PlusIcon class="mr-1 size-3.5" />
				Add Widget
			</Button>
		{/if}

		<Button
			variant="outline"
			size="sm"
			class="h-7"
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
