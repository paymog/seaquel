<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { getDatabase } from "$lib/storage/db";
	import { appStateRepo } from "$lib/storage/repository";

	let queryVersionLimit = $state<number>(100);
	let dashboardVersionLimit = $state<number>(100);

	onMount(async () => {
		const savedLimit = await appStateRepo.get(await getDatabase(), "query_version_limit");
		if (savedLimit) {
			const parsed = parseInt(savedLimit, 10);
			if (!isNaN(parsed)) queryVersionLimit = parsed;
		}
		const savedDashboardLimit = await appStateRepo.get(await getDatabase(), "dashboard_version_limit");
		if (savedDashboardLimit) {
			const parsed = parseInt(savedDashboardLimit, 10);
			if (!isNaN(parsed)) dashboardVersionLimit = parsed;
		}
	});
</script>

<div class="space-y-6" data-section="query-history">
	<div>
		<h2 class="text-lg font-medium">{m.settings_query_history()}</h2>
		<p class="text-sm text-muted-foreground mt-1">{m.settings_query_history_description()}</p>
	</div>
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium">{m.settings_query_version_limit()}</p>
				<p class="text-sm text-muted-foreground">{m.settings_query_version_limit_description()}</p>
			</div>
			<input
				type="number"
				min="10"
				max="1000"
				bind:value={queryVersionLimit}
				onchange={async () => {
					const db = await getDatabase();
					await appStateRepo.set(db, "query_version_limit", String(queryVersionLimit));
				}}
				class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
			/>
		</div>
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium">{m.settings_dashboard_version_limit()}</p>
				<p class="text-sm text-muted-foreground">{m.settings_dashboard_version_limit_description()}</p>
			</div>
			<input
				type="number"
				min="10"
				max="1000"
				bind:value={dashboardVersionLimit}
				onchange={async () => {
					const db = await getDatabase();
					await appStateRepo.set(db, "dashboard_version_limit", String(dashboardVersionLimit));
				}}
				class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
			/>
		</div>
	</div>
</div>
