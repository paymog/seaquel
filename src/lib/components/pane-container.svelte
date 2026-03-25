<script lang="ts">
    import { useDatabase } from "$lib/hooks/database.svelte.js";
    import { PaneGroup, Pane, Handle } from "$lib/components/ui/resizable";
    import PaneContent from "$lib/components/pane-content.svelte";
    import { setPaneDragState } from "$lib/components/pane-drag-context.svelte.js";

    const db = useDatabase();
    setPaneDragState();

    // Create default pane layout if none exists (must be in $effect, not $derived, to avoid state_unsafe_mutation)
    $effect(() => {
        if (db.state.activeProjectId) {
            const existing = db.state.paneLayoutByProject[db.state.activeProjectId];
            if (!existing || existing.panes.length === 0) {
                db.panes.ensureLayout();
            }
        }
    });

    const layout = $derived(
        db.state.activeProjectId
            ? db.state.paneLayoutByProject[db.state.activeProjectId] ?? { panes: [], activePaneId: "" }
            : { panes: [], activePaneId: "" }
    );
    const panes = $derived(layout.panes);
</script>

{#if panes.length <= 1}
    <!-- Single pane: no resizable wrapper needed -->
    {#if panes[0]}
        <PaneContent
            pane={panes[0]}
            isActive={true}
            totalPanes={1}
        />
    {/if}
{:else}
    <!-- Multiple panes: use paneforge for resizable splits -->
    <PaneGroup direction="horizontal" class="h-full">
        {#each panes as pane, i (pane.id)}
            <Pane defaultSize={100 / panes.length} minSize={15}>
                <PaneContent
                    {pane}
                    isActive={pane.id === layout.activePaneId}
                    totalPanes={panes.length}
                />
            </Pane>
            {#if i < panes.length - 1}
                <Handle />
            {/if}
        {/each}
    </PaneGroup>
{/if}
