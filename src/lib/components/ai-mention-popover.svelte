<script lang="ts">
	import type { MentionItem, MentionKind } from "$lib/services/ai-mentions";
	import Table from "@lucide/svelte/icons/table";
	import FileText from "@lucide/svelte/icons/file-text";
	import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";

	interface Props {
		items: MentionItem[];
		filter: string;
		onSelect: (item: MentionItem) => void;
		onClose: () => void;
	}

	const iconByKind = {
		table: Table,
		query: FileText,
		dashboard: LayoutDashboard,
	} as const;

	const groupLabel: Record<MentionKind, string> = {
		table: "Tables",
		query: "Saved Queries",
		dashboard: "Dashboards",
	};

	const groupOrder: MentionKind[] = ["table", "query", "dashboard"];

	let { items, filter, onSelect, onClose }: Props = $props();

	let selectedIndex = $state(0);

	const filtered = $derived.by(() => {
		const lower = filter.toLowerCase();
		const result = lower
			? items.filter((item) => item.searchText.includes(lower))
			: items;
		return result.slice(0, 12);
	});

	const groups = $derived.by(() => {
		const map = new Map<MentionKind, MentionItem[]>();
		for (const item of filtered) {
			const list = map.get(item.kind) ?? [];
			list.push(item);
			map.set(item.kind, list);
		}
		return groupOrder.filter((k) => map.has(k)).map((kind) => ({
			kind,
			label: groupLabel[kind],
			items: map.get(kind)!,
		}));
	});

	// Flat list for keyboard navigation index
	const flatItems = $derived(groups.flatMap((g) => g.items));

	// Reset selection when filter text changes
	$effect(() => {
		void filter;
		selectedIndex = 0;
	});

	export function handleKeydown(e: KeyboardEvent): boolean {
		if (flatItems.length === 0) return false;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			selectedIndex = (selectedIndex + 1) % flatItems.length;
			return true;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			selectedIndex = (selectedIndex - 1 + flatItems.length) % flatItems.length;
			return true;
		}

		if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			onSelect(flatItems[selectedIndex]);
			return true;
		}

		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			return true;
		}

		return false;
	}
</script>

{#if flatItems.length > 0}
	<div
		class="absolute bottom-full left-0 mb-1 z-50 w-72 max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
	>
		{#each groups as group}
			<div class="px-2.5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sticky top-0 bg-popover">
				{group.label}
			</div>
			{#each group.items as item (item.token)}
				{@const Icon = iconByKind[item.kind]}
				{@const globalIndex = flatItems.indexOf(item)}
				<button
					class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors"
					class:bg-accent={globalIndex === selectedIndex}
					onmousedown={(e) => {
						e.preventDefault();
						onSelect(item);
					}}
					onmouseenter={() => {
						selectedIndex = globalIndex;
					}}
				>
					<Icon class="size-3.5 shrink-0 text-muted-foreground" />
					<span class="truncate">{item.label}</span>
				</button>
			{/each}
		{/each}
	</div>
{/if}
