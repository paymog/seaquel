<script lang="ts">
    import { fileDropState } from "$lib/services/file-drop.svelte.js";
</script>

{#if fileDropState.visible}
    <div
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none"
    >
        <div
            class="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-primary p-12"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary"
            >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <div class="text-center">
                <p class="text-lg font-medium text-foreground">
                    Drop to query
                </p>
                <p class="text-sm text-muted-foreground">
                    Parquet, CSV, JSON, Excel, or DuckDB files
                </p>
            </div>
            {#if fileDropState.fileNames.length > 0}
                <div class="flex flex-wrap gap-2 max-w-md justify-center">
                    {#each fileDropState.fileNames as name (name)}
                        <span
                            class="rounded-md bg-primary/10 px-2 py-1 text-xs font-mono text-primary"
                        >
                            {name}
                        </span>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}
