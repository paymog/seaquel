<script lang="ts">
	import { onMount, tick } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { Button } from "$lib/components/ui/button";
	import { readLogFile } from "$lib/api/tauri";
	import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

	let logContent = $state("");
	let loading = $state(true);
	let error = $state("");
	// oxlint-disable-next-line eslint(no-unassigned-vars)
	let scrollContainer: HTMLDivElement;

	async function scrollToBottom() {
		await tick();
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	async function loadLogs() {
		loading = true;
		error = "";
		try {
			logContent = await readLogFile();
		} catch (e) {
			error = `${e}`;
		} finally {
			loading = false;
			await scrollToBottom();
		}
	}

	onMount(() => {
		loadLogs();
	});
</script>

<div class="flex flex-col h-screen bg-background text-foreground">
	<header class="flex items-center justify-between border-b px-4 py-2 shrink-0" data-tauri-drag-region>
		<h1 class="text-sm font-medium">{m.settings_view_logs()}</h1>
		<Button variant="ghost" size="sm" onclick={loadLogs} disabled={loading}>
			<RefreshCwIcon class="size-4 mr-1" />
			Refresh
		</Button>
	</header>
	<div class="flex-1 overflow-auto p-4 min-h-0" bind:this={scrollContainer}>
		{#if loading}
			<p class="text-sm text-muted-foreground">Loading...</p>
		{:else if error}
			<p class="text-sm text-destructive">{error}</p>
		{:else}
			<pre class="text-xs font-mono whitespace-pre-wrap break-all">{logContent}</pre>
		{/if}
	</div>
</div>
