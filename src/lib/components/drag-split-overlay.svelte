<script lang="ts">
    import type { PaneDragState } from "$lib/components/pane-drag-context.svelte.js";

    let {
        paneId,
        dragState,
    }: {
        paneId: string;
        dragState: PaneDragState;
    } = $props();

    // Show ghost preview when this pane is the split target
    const splitPreview = $derived(
        dragState.isDragging &&
        dragState.splitTarget?.paneId === paneId
            ? dragState.splitTarget.direction
            : null
    );

    // Move target indicator
    const moveTarget = $derived(
        dragState.isDragging &&
        dragState.moveTarget?.paneId === paneId
            ? dragState.moveTarget
            : null
    );
</script>

{#if splitPreview === 'left'}
    <div class="absolute inset-y-0 left-0 w-1/2 bg-primary/10 border-r-2 border-primary/30 pointer-events-none z-40 rounded-sm"></div>
{:else if splitPreview === 'right'}
    <div class="absolute inset-y-0 right-0 w-1/2 bg-primary/10 border-l-2 border-primary/30 pointer-events-none z-40 rounded-sm"></div>
{/if}

<!-- Vertical insertion line when moving a tab into this pane -->
{#if moveTarget}
    <div
        class="fixed w-0.5 bg-primary rounded-full pointer-events-none z-50"
        style="left: {moveTarget.indicatorX}px; top: {moveTarget.indicatorY}px; height: {moveTarget.indicatorH}px;"
    ></div>
{/if}
