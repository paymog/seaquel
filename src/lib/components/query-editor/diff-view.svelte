<script lang="ts">
	import MonacoDiffEditor from "$lib/components/monaco-diff-editor.svelte";
	import type { DiffModeState } from "./view-state.svelte.js";

	let {
		diffMode,
		originalWidth = $bindable(0),
		onRestore,
		onClose,
	}: {
		diffMode: DiffModeState;
		originalWidth: number;
		onRestore: (query: string) => void;
		onClose: () => void;
	} = $props();
</script>

<div class="flex flex-col h-full">
	<div class="flex items-center bg-muted/50 border-b text-xs shrink-0">
		<div class="flex items-center gap-2 px-3 py-1.5 border-r border-border shrink-0" style:width="{originalWidth}px">
			<span class="text-muted-foreground">{diffMode.leftLabel}</span>
			{#if diffMode.restoreLeft}
				<button class="text-xs text-primary hover:underline" onclick={() => onRestore(diffMode.restoreLeft!)}>
					Restore
				</button>
			{/if}
		</div>
		<div class="flex-1 flex items-center px-3 py-1.5">
			<span class="text-muted-foreground">{diffMode.rightLabel}</span>
			{#if diffMode.restoreRight}
				<button class="text-xs text-primary hover:underline ms-2" onclick={() => onRestore(diffMode.restoreRight!)}>
					Restore
				</button>
			{/if}
			<button class="text-xs text-muted-foreground hover:text-foreground ms-auto" onclick={onClose}>
				Close
			</button>
		</div>
	</div>
	<div class="flex-1 min-h-0">
		<MonacoDiffEditor original={diffMode.original} modified={diffMode.modified} bind:originalWidth />
	</div>
</div>
