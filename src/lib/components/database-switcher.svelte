<script lang="ts">
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { getAdapter } from "$lib/db";
	import { DatabaseIcon } from "@lucide/svelte";
	import { errorToast } from "$lib/utils/toast";
	import { toast } from "svelte-sonner";

	const db = useDatabase();

	let databases = $state<string[]>([]);
	let isSwitching = $state(false);

	const activeConnection = $derived(db.state.activeConnection);

	// Only engines that expose multiple databases per server (e.g. Postgres)
	// implement getDatabasesQuery — for everything else this stays hidden.
	const supportsSwitching = $derived(
		!!activeConnection && !!getAdapter(activeConnection.type).getDatabasesQuery,
	);

	async function loadDatabases(connectionId: string) {
		try {
			databases = await db.connections.getAvailableDatabases(connectionId);
		} catch {
			databases = [];
		}
	}

	// Re-fetch the cluster's database list whenever the active connection changes.
	$effect(() => {
		const id = activeConnection?.id;
		if (!id || !supportsSwitching) {
			databases = [];
			return;
		}
		void loadDatabases(id);
	});

	async function handleSwitch(databaseName: string) {
		const id = activeConnection?.id;
		if (!id || !databaseName || databaseName === activeConnection?.databaseName) return;
		isSwitching = true;
		try {
			await db.connections.switchDatabase(id, databaseName);
			toast.success(`Switched to database "${databaseName}"`);
		} catch (error) {
			errorToast(
				`Failed to switch database: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			isSwitching = false;
		}
	}
</script>

{#if supportsSwitching && databases.length > 1}
	<div class="px-4 pt-2 pb-1">
		<Select.Root
			type="single"
			value={activeConnection?.databaseName}
			onValueChange={(v) => handleSwitch(v)}
			disabled={isSwitching}
		>
			<Select.Trigger class="w-full h-8 text-xs">
				<DatabaseIcon class="size-3.5 mr-1.5 shrink-0" />
				<span class="truncate">{activeConnection?.databaseName || "Select database"}</span>
			</Select.Trigger>
			<Select.Content class="max-h-60">
				{#each databases as name (name)}
					<Select.Item value={name} label={name}>{name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
{/if}
