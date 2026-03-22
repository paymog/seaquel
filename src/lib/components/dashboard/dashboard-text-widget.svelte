<script lang="ts">
	import type { DashboardWidget } from '$lib/types';

	interface Props {
		widget: DashboardWidget;
	}

	let { widget }: Props = $props();

	const content = $derived(widget.textConfig?.content ?? '');
</script>

<div class="flex h-full flex-col items-center justify-center p-2" style="container-type: size;">
	{#if content}
		<p class="font-bold whitespace-pre-wrap wrap-break-words text-center" style="font-size: clamp(1rem, 20cqh, 6rem); line-height: 1.2;">
			{content}
		</p>
	{:else}
		<p class="text-sm text-muted-foreground">No text content</p>
	{/if}
</div>
