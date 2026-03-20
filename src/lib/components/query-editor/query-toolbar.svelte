<script lang="ts">
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Badge } from "$lib/components/ui/badge";
	import ShortcutKeys from "$lib/components/shortcut-keys.svelte";
	import ConnectionSelector from "$lib/components/connection-selector.svelte";
	import { findShortcut } from "$lib/shortcuts/index.js";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import {
		PlayIcon,
		SaveIcon,
		LoaderIcon,
		ChevronDownIcon,
		WandSparklesIcon,
		XCircleIcon,
		SearchIcon,
		ActivityIcon,
		NetworkIcon,
		GitBranchIcon
	} from "@lucide/svelte";
	import { m } from "$lib/paraglide/messages.js";
	import type { StatementResult } from "$lib/types";

	type Props = {
		isExecuting: boolean;
		hasQuery: boolean;
		activeResult: StatementResult | null | undefined;
		liveStatementCount: number;
		onExecute: () => void;
		onExecuteCurrent: () => void;
		onExplain: (analyze: boolean) => void;
		onVisualize: () => void;
		onFormat: () => void;
		onSave: () => void;
		onShare?: () => void;
	};

	let {
		isExecuting,
		hasQuery,
		activeResult,
		liveStatementCount,
		onExecute,
		onExecuteCurrent,
		onExplain,
		onVisualize,
		onFormat,
		onSave,
		onShare
	}: Props = $props();

	const db = useDatabase();

	// Check if shared repos exist
	const hasSharedRepos = $derived(db.state.sharedRepos.length > 0);
</script>

<div class="flex items-center justify-between p-2 shrink-0">
	<div class="flex items-center gap-3 text-xs">
		<ConnectionSelector />

		{#if liveStatementCount > 1}
			<span class="flex items-center gap-1">
				<Badge variant="outline" class="text-xs text-muted-foreground"
					>{m.query_statements_count({ count: liveStatementCount })}</Badge
				>
			</span>
		{/if}
		{#if activeResult}
			{#if activeResult.isError}
				<span class="flex items-center gap-1 text-destructive">
					<XCircleIcon class="size-3" />
					{m.query_error()}
				</span>
			{:else if activeResult.queryType && ['insert', 'update', 'delete'].includes(activeResult.queryType)}
				<span class="flex items-center gap-1">
					<Badge variant="secondary" class="text-xs text-muted-foreground"
						>{activeResult.affectedRows ?? 0}</Badge
					>
					{m.query_rows_affected()}
					{#if activeResult.lastInsertId}
						<Badge variant="outline" class="text-xs ms-1"
							>ID: {activeResult.lastInsertId}</Badge
						>
					{/if}
				</span>
			{/if}
		{/if}
	</div>
	<div class="flex items-center gap-2">
		<div class="flex">
			<Button
				size="sm"
				class="h-7 gap-1 rounded-r-none border-r-0"
				onclick={onExecuteCurrent}
				disabled={isExecuting}
			>
				{#if isExecuting}
					<LoaderIcon class="animate-spin size-3" />
				{:else}
					<PlayIcon class="size-3" />
				{/if}
				{m.query_execute()}
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class={buttonVariants({ size: "sm", variant: "default" }) +
						" !h-7 px-1.5 rounded-l-none border-l border-primary-foreground/20"}
					disabled={isExecuting}
				>
					<ChevronDownIcon class="size-3" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={onExecuteCurrent}>
						<PlayIcon class="size-4 me-2" />
						{m.query_execute_current()}
						{#if findShortcut('executeQuery')}
							<ShortcutKeys keys={findShortcut('executeQuery')!.keys} class="ms-auto" />
						{/if}
					</DropdownMenu.Item>
					{#if liveStatementCount > 1}
						<DropdownMenu.Item onclick={onExecute}>
							<PlayIcon class="size-4 me-2" />
							{m.query_execute_all()}
						</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => onExplain(false)}>
						<SearchIcon class="size-4 me-2" />
						{m.query_explain()}
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => onExplain(true)}>
						<ActivityIcon class="size-4 me-2" />
						{m.query_explain_analyze()}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={onVisualize}>
						<NetworkIcon class="size-4 me-2" />
						Visualize Query
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
		<Button
			size="sm"
			variant="outline"
			class="h-7 gap-1"
			onclick={onFormat}
			disabled={!hasQuery}
		>
			<WandSparklesIcon class="size-3" />
			{m.query_format()}
			{#if findShortcut('formatSql')}
				<ShortcutKeys keys={findShortcut('formatSql')!.keys} class="ms-1" />
			{/if}
		</Button>
		<div class="flex">
			<Button
				size="sm"
				variant="outline"
				class="h-7 gap-1 rounded-r-none border-r-0"
				onclick={onSave}
				disabled={!hasQuery}
			>
				<SaveIcon class="size-3" />
				{m.query_save()}
				{#if findShortcut('saveQuery')}
					<ShortcutKeys keys={findShortcut('saveQuery')!.keys} class="ms-1" />
				{/if}
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class={buttonVariants({ size: "sm", variant: "outline" }) +
						" !h-7 px-1.5 rounded-l-none"}
					disabled={!hasQuery}
				>
					<ChevronDownIcon class="size-3" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={onSave}>
						<SaveIcon class="size-4 me-2" />
						{m.query_save()}
						{#if findShortcut('saveQuery')}
							<ShortcutKeys keys={findShortcut('saveQuery')!.keys} class="ms-auto" />
						{/if}
					</DropdownMenu.Item>
					{#if onShare}
						<DropdownMenu.Item onclick={onShare} disabled={!hasSharedRepos}>
							<GitBranchIcon class="size-4 me-2" />
							Share to Repository
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</div>
