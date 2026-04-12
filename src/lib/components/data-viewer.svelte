<script lang="ts">
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { m } from "$lib/paraglide/messages.js";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Select from "$lib/components/ui/select/index.js";
	import {
		RefreshCwIcon,
		FilterIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		ChevronsLeftIcon,
		ChevronsRightIcon,
		LoaderIcon,
		CheckIcon,
		XIcon,
	} from "@lucide/svelte";
	import type { DataFilter, ForeignKeyRef, SchemaColumn, SchemaTable } from "$lib/types";
	import VirtualResultsTable from "$lib/components/virtual-results-table.svelte";
	import DataFilterBar from "$lib/components/data-filter-bar.svelte";
	import { inputTypeForColumnType, inputStepForColumnType } from "$lib/utils/cell-type";
	import { toast } from "svelte-sonner";
	import { tick } from "svelte";

	let { tabId }: { tabId: string } = $props();

	const db = useDatabase();
	const tab = $derived(db.state.dataTabs.find((t) => t.id === tabId) ?? null);

	// Get table columns from schema cache for filter dropdowns
	const tableColumns = $derived.by((): SchemaColumn[] => {
		if (!tab) return [];
		const schemas = db.state.schemas[tab.connectionId] ?? [];
		const table = schemas.find(
			(t) => t.name === tab.tableName && t.schema === tab.schemaName,
		);
		return table?.columns ?? [];
	});

	const hasPrimaryKey = $derived(tableColumns.some((c) => c.isPrimaryKey));

	// Build FK column map for navigation
	const foreignKeyColumns = $derived.by((): Map<string, { ref: ForeignKeyRef; table: SchemaTable }> => {
		const map = new Map<string, { ref: ForeignKeyRef; table: SchemaTable }>();
		if (!tab) return map;
		const schemas = db.state.schemas[tab.connectionId] ?? [];
		for (const col of tableColumns) {
			if (col.isForeignKey && col.foreignKeyRef) {
				const ref = col.foreignKeyRef;
				const refTable = schemas.find(
					(t) => t.name === ref.referencedTable && t.schema === ref.referencedSchema,
				);
				if (refTable) {
					map.set(col.name, { ref, table: refTable });
				}
			}
		}
		return map;
	});

	function handleForeignKeyClick(ref: ForeignKeyRef, table: SchemaTable, value: string) {
		db.dataTabs.add(table, { column: ref.referencedColumn, value });
		db.ui.setActiveView("data");
	}

	const initialTab = db.state.dataTabs.find((t) => t.id === tabId);
	let showFilters = $state(initialTab?.filters.some((f) => f.enabled) ?? false);
	let deletingRowIndex = $state<number | null>(null);
	let savingRowIndex = $state<number | null>(null);

	// Editable values for pending rows, keyed by tabId so they reset on tab switch
	let pendingRowValuesByTab = $state<Record<string, Record<string, string>[]>>({});
	const pendingRowValues = $derived(pendingRowValuesByTab[tabId] ?? []);

	function setPendingRowValues(rows: Record<string, string>[]) {
		pendingRowValuesByTab = { ...pendingRowValuesByTab, [tabId]: rows };
	}

	// Context menu state for set null / set default
	let contextRowIndex = $state<number | null>(null);
	let contextColumn = $state<string | null>(null);

	// Pending changes indicators for this table
	const primaryKeyColumns = $derived(tableColumns.filter((c) => c.isPrimaryKey).map((c) => c.name));

	const pendingChangesForTable = $derived.by(() => {
		if (!tab) return [];
		return db.state.activePendingChanges.filter(
			(c) => c.target?.schema === tab.schemaName && c.target?.table === tab.tableName,
		);
	});

	const pendingCellEdits = $derived.by(() => {
		if (!tab?.results?.rows) return undefined;
		const edits = new Map<string, unknown>();
		for (const change of pendingChangesForTable) {
			if ((change.origin === "inline-edit" || change.origin === "set-default") && change.target?.primaryKeyValues && change.target.column) {
				const rowIdx = tab.results.rows.findIndex((row) =>
					primaryKeyColumns.every((pk) => String(row[pk]) === String(change.target!.primaryKeyValues![pk])),
				);
				if (rowIdx >= 0) {
					edits.set(`${rowIdx}:${change.target.column}`, change.target.newValue);
				}
			}
		}
		return edits.size > 0 ? edits : undefined;
	});

	const pendingRowDeletes = $derived.by(() => {
		if (!tab?.results?.rows) return undefined;
		const deletes = new Set<number>();
		for (const change of pendingChangesForTable) {
			if (change.origin === "delete-row" && change.target?.primaryKeyValues) {
				const rowIdx = tab.results.rows.findIndex((row) =>
					primaryKeyColumns.every((pk) => String(row[pk]) === String(change.target!.primaryKeyValues![pk])),
				);
				if (rowIdx >= 0) {
					deletes.add(rowIdx);
				}
			}
		}
		return deletes.size > 0 ? deletes : undefined;
	});

	const pendingInsertRows = $derived(
		pendingChangesForTable
			.filter((c) => c.origin === "insert-row" && c.target?.insertValues)
			.map((c) => ({ id: c.id, values: c.target!.insertValues as Record<string, unknown> })),
	);

	function handleRemovePendingInsert(changeId: string) {
		const connectionId = db.state.activeConnectionId;
		if (connectionId) {
			db.pendingChanges.remove(connectionId, changeId);
		}
	}

	// Pagination derived
	const totalPages = $derived(
		tab?.results ? Math.max(1, Math.ceil((tab.totalRows ?? 0) / tab.pageSize)) : 1,
	);
	const showingFrom = $derived(tab ? (tab.page - 1) * tab.pageSize + 1 : 0);
	const showingTo = $derived(
		tab ? Math.min(tab.page * tab.pageSize, tab.totalRows ?? 0) : 0,
	);

	// Sort indicator
	const currentSort = $derived(tab?.sortColumns[0] ?? null);

	// Result columns for display
	const resultColumns = $derived(tab?.results?.columns ?? []);

	function handleFilterChange(filters: DataFilter[], logic: "AND" | "OR") {
		if (!tab) return;
		db.dataTabs.setFilters(tabId, filters, logic);
		if (filters.length === 0) {
			showFilters = false;
		}
	}

	function handleRefresh() {
		void db.dataTabs.refresh(tabId);
	}

	function handleAddRow() {
		const defaults: Record<string, string> = {};
		for (const col of tableColumns) {
			defaults[col.name] = "";
		}
		setPendingRowValues([...pendingRowValues, defaults]);
		db.dataTabs.addNewRow(tabId);
	}

	function handleCancelNewRow(index: number) {
		setPendingRowValues(pendingRowValues.filter((_, i) => i !== index));
		db.dataTabs.cancelNewRow(tabId, index);
	}

	async function handleSaveNewRow(index: number) {
		const values = pendingRowValues[index];
		if (!values) return;

		// Filter out empty values for nullable columns, keep non-empty ones
		const insertValues: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(values)) {
			if (val !== "") {
				insertValues[key] = val;
			}
		}

		if (Object.keys(insertValues).length === 0) {
			toast.error("At least one value is required");
			return;
		}

		savingRowIndex = index;
		try {
			const success = await db.dataTabs.saveNewRow(tabId, index, insertValues);
			if (success) {
				// Wait for reactive updates (pending insert row or refreshed data) to render
				// before removing the inline editable row, to avoid a visual flash.
				await tick();
				setPendingRowValues(pendingRowValues.filter((_, i) => i !== index));
				toast.success("Row inserted");
			} else {
				toast.error("Failed to insert row");
			}
		} catch (error) {
			toast.error(
				`Failed to insert row: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			savingRowIndex = null;
		}
	}

	function handleColumnHeaderClick(column: string) {
		db.dataTabs.toggleSort(tabId, column);
	}

	async function handleCellSave(rowIndex: number, column: string, newValue: string | null) {
		if (!tab?.results?.sourceTable) return;
		const row = tab.results.rows[rowIndex];
		if (!row) return;

		const result = await db.queries.updateCellDirect(
			tab.results.sourceTable,
			row,
			column,
			newValue,
		);

		if (result.success) {
			if (result.queued) {
				toast.info("Change added to pending changes");
			} else {
				void db.dataTabs.refresh(tabId);
			}
		} else {
			toast.error(`Failed to update cell: ${result.error ?? "Unknown error"}`);
		}
	}

	async function handleRowDelete(rowIndex: number, row: Record<string, unknown>) {
		if (!tab?.results?.sourceTable) return;
		deletingRowIndex = rowIndex;

		try {
			const result = await db.queries.deleteRow(tab.results.sourceTable, row);
			if (result.queued) {
				toast.info("Delete added to pending changes");
			} else {
				void db.dataTabs.refresh(tabId);
			}
		} catch (error) {
			toast.error(
				`Failed to delete row: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			deletingRowIndex = null;
		}
	}

	function handleCellRightClick(
		value: unknown,
		column: string,
		row: Record<string, unknown>,
		rowIndex: number,
	) {
		contextRowIndex = rowIndex;
		contextColumn = column;
	}

	async function handleSetNull() {
		if (contextRowIndex != null && contextColumn != null) {
			await handleCellSave(contextRowIndex, contextColumn, null);
		}
	}

	async function handleSetDefault() {
		if (contextRowIndex == null || contextColumn == null) return;
		if (!tab?.results?.sourceTable) return;
		const row = tab.results.rows[contextRowIndex];
		if (!row) return;

		const result = await db.queries.setCellDefaultDirect(
			tab.results.sourceTable,
			row,
			contextColumn,
		);

		if (result.success) {
			if (result.queued) {
				toast.info("Change added to pending changes");
			} else {
				void db.dataTabs.refresh(tabId);
			}
		} else {
			toast.error(`Failed to set default: ${result.error ?? "Unknown error"}`);
		}
	}

	const pageSizes = [25, 50, 100, 250, 500, 1000];
</script>

<div class="flex flex-col h-full overflow-hidden">
	{#if tab}
		<!-- Toolbar -->
		<div class="flex items-center justify-between ps-4 pe-2 py-2 border-b shrink-0">
			<div class="flex items-center gap-3 text-xs">
				<span class="font-semibold">
					{tab.schemaName}.{tab.tableName}
				</span>
				{#if tab.totalRows != null}
					<span class="text-xs text-muted-foreground">
						{tab.totalRows.toLocaleString()} rows
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<Button
					size="sm"
					class="h-7"
					variant={showFilters ? "secondary" : "ghost"}
					onclick={() => {
						if (!showFilters && tab.filters.length === 0) {
							// Auto-add the first filter when opening with no filters
							const firstCol = tableColumns[0]?.name ?? "";
							const newFilter: DataFilter = {
								id: crypto.randomUUID(),
								column: firstCol,
								operator: "=",
								value: "",
								enabled: true,
							};
							db.dataTabs.setFilters(tabId, [newFilter], tab.filterLogic);
						}
						showFilters = !showFilters;
					}}
				>
					<FilterIcon class="size-3 me-1" />
					{m.data_viewer_filters()}
					{#if tab.filters.filter((f) => f.enabled).length > 0}
						<span class="ml-1 text-xs bg-primary text-primary-foreground rounded-full size-4 flex items-center justify-center">
							{tab.filters.filter((f) => f.enabled).length}
						</span>
					{/if}
				</Button>
				<Button
					size="sm"
					class="h-7"
					variant="ghost"
					onclick={handleRefresh}
					disabled={tab.isLoading}
				>
					<RefreshCwIcon class={["size-3 me-1", tab.isLoading && "animate-spin"]} />
					{m.data_viewer_refresh()}
				</Button>
			</div>
		</div>

		<!-- Filter Bar -->
		{#if showFilters}
			<DataFilterBar
				columns={tableColumns}
				filters={tab.filters}
				filterLogic={tab.filterLogic}
				onFiltersChange={handleFilterChange}
			/>
		{/if}

		<!-- Data Grid -->
		<div class="flex-1 min-h-0 flex flex-col relative">
			{#if tab.isLoading && !tab.results}
				<div class="flex items-center justify-center flex-1">
					<LoaderIcon class="size-5 animate-spin text-muted-foreground" />
					<span class="ml-2 text-sm text-muted-foreground">{m.data_viewer_loading()}</span>
				</div>
			{:else if tab.results}
				{#if tab.results.isError}
					<div class="flex items-center justify-center flex-1 p-4">
						<p class="text-sm text-destructive">{tab.results.error}</p>
					</div>
				{:else}
					<!-- Results table takes remaining space minus pending rows -->
					<div class="min-h-0 flex-1 flex flex-col">
						{#snippet pendingRowsContent(gridTemplate: string)}
						{#each pendingRowValues as rowValues, rowIdx (rowIdx)}
							<div
								class="grid border-b border-dashed border-primary/30 bg-primary/5 text-sm"
								style="grid-template-columns: {gridTemplate};"
							>
								<div class="flex items-center justify-center">
									<Button
										size="icon"
										variant="ghost"
										class="size-6 text-primary hover:text-primary"
										onclick={() => handleSaveNewRow(rowIdx)}
										disabled={savingRowIndex === rowIdx}
									>
										{#if savingRowIndex === rowIdx}
											<LoaderIcon class="size-3 animate-spin" />
										{:else}
											<CheckIcon class="size-3" />
										{/if}
									</Button>
									<Button
										size="icon"
										variant="ghost"
										class="size-6"
										onclick={() => handleCancelNewRow(rowIdx)}
										disabled={savingRowIndex === rowIdx}
									>
										<XIcon class="size-3" />
									</Button>
								</div>
								{#each resultColumns as col}
									{@const schemCol = tableColumns.find((c) => c.name === col)}
									{@const colInputType = schemCol ? inputTypeForColumnType(schemCol.type) : "text"}
									{@const colStep = schemCol ? inputStepForColumnType(schemCol.type) : undefined}
									<div class="px-1 py-1">
										<Input
											value={rowValues[col] ?? ""}
											type={colInputType}
											step={colStep}
											placeholder={schemCol?.defaultValue ? `Default: ${schemCol.defaultValue}` : schemCol?.nullable ? "NULL" : col}
											class="h-7 text-xs font-mono"
											disabled={savingRowIndex === rowIdx}
											oninput={(e) => {
												const updated = [...pendingRowValues];
												updated[rowIdx] = { ...updated[rowIdx], [col]: (e.target as HTMLInputElement).value };
												setPendingRowValues(updated);
											}}
										/>
									</div>
								{/each}
							</div>
						{/each}
					{/snippet}

					<VirtualResultsTable
							columns={tab.results.columns}
							rows={tab.results.rows}
							isEditable={hasPrimaryKey}
							onCellSave={handleCellSave}
							onRowDelete={handleRowDelete}
							{deletingRowIndex}
							onCellRightClick={handleCellRightClick}
							onSetNull={handleSetNull}
							onSetDefault={handleSetDefault}
							onColumnHeaderClick={handleColumnHeaderClick}
							sortColumn={currentSort?.column}
							sortDirection={currentSort?.direction}
							onAddRow={hasPrimaryKey ? handleAddRow : undefined}
							{pendingRowsContent}
							{pendingCellEdits}
							{pendingRowDeletes}
							{pendingInsertRows}
							onRemovePendingInsert={handleRemovePendingInsert}
							{foreignKeyColumns}
							onForeignKeyClick={handleForeignKeyClick}
						/>
					</div>
				{/if}
			{/if}

			{#if tab.isLoading && tab.results}
				<div class="absolute inset-0 bg-background/50 flex items-center justify-center">
					<LoaderIcon class="size-5 animate-spin text-muted-foreground" />
				</div>
			{/if}
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between px-4 py-2 border-t shrink-0 text-xs bg-background relative z-10">
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground">
					{#if (tab.totalRows ?? 0) > 0}
						Showing {showingFrom}-{showingTo} of {(tab.totalRows ?? 0).toLocaleString()}
					{:else}
						No rows
					{/if}
				</span>
			</div>
			<div class="flex items-center gap-2">
				<Select.Root
					type="single"
					value={String(tab.pageSize)}
					onValueChange={(v) => db.dataTabs.setPageSize(tabId, Number(v))}
				>
					<Select.Trigger class="h-7 text-xs w-[100px]">
						{tab.pageSize} rows
					</Select.Trigger>
					<Select.Content>
						{#each pageSizes as size}
							<Select.Item value={String(size)}>{size}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<div class="flex items-center gap-0.5">
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						disabled={tab.page <= 1}
						onclick={() => db.dataTabs.setPage(tabId, 1)}
					>
						<ChevronsLeftIcon class="size-3" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						disabled={tab.page <= 1}
						onclick={() => db.dataTabs.setPage(tabId, tab.page - 1)}
					>
						<ChevronLeftIcon class="size-3" />
					</Button>
					<span class="px-2 text-muted-foreground">
						{tab.page} / {totalPages}
					</span>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						disabled={tab.page >= totalPages}
						onclick={() => db.dataTabs.setPage(tabId, tab.page + 1)}
					>
						<ChevronRightIcon class="size-3" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						disabled={tab.page >= totalPages}
						onclick={() => db.dataTabs.setPage(tabId, totalPages)}
					>
						<ChevronsRightIcon class="size-3" />
					</Button>
				</div>
			</div>
		</div>
	{/if}
</div>
