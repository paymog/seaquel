<script lang="ts">
	import type { DashboardWidget } from '$lib/types';
	import { RefreshCwIcon, Loader2Icon } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import QueryChart from '$lib/components/charts/query-chart.svelte';
	import DashboardKpiWidget from './dashboard-kpi-widget.svelte';
	import DashboardTextWidget from './dashboard-text-widget.svelte';

	interface Props {
		widget: DashboardWidget;
		isEditing?: boolean;
		onclick: () => void;
		onRefresh: () => void;
	}

	let { widget, isEditing = false, onclick, onRefresh }: Props = $props();

	const columns = $derived(
		widget.result && widget.result.length > 0
			? Object.keys(widget.result[0])
			: []
	);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="group relative flex h-full flex-col rounded-lg border bg-card shadow-sm overflow-hidden cursor-pointer hover:border-foreground/20 transition-colors {isEditing ? 'ring-2 ring-primary border-primary' : ''}"
	{onclick}
>
	<!-- Header -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex items-center gap-1 border-b px-2 py-1.5 shrink-0"
		onclick={(e) => e.stopPropagation()}
	>
		<span class="text-xs font-medium truncate flex-1">{widget.title}</span>
		{#if widget.isLoading}
			<Loader2Icon class="size-3 animate-spin text-muted-foreground shrink-0" />
		{/if}
		{#if widget.widgetType !== 'text'}
			<Button
				variant="ghost"
				size="icon"
				class="size-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
				onclick={(e) => { e.stopPropagation(); onRefresh(); }}
			>
				<RefreshCwIcon class="size-3" />
			</Button>
		{/if}
	</div>

	<!-- Content -->
	<div class="flex-1 min-h-0 overflow-hidden" style="container-type: size;">
		{#if widget.widgetType === 'text'}
			<DashboardTextWidget {widget} />
		{:else if widget.error}
			<div class="flex h-full items-center justify-center p-4 text-destructive text-xs">
				{widget.error}
			</div>
		{:else if widget.widgetType === 'kpi'}
			<DashboardKpiWidget {widget} />
		{:else if widget.result && widget.result.length > 0 && columns.length > 0}
			<QueryChart
				columns={columns}
				rows={widget.result}
				config={widget.chartConfig}
			/>
		{:else if !widget.isLoading}
			<div class="flex h-full items-center justify-center text-xs text-muted-foreground">
				{widget.query ? 'No data returned' : 'No query configured'}
			</div>
		{/if}
	</div>
</div>
