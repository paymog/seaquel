/**
 * Pure functions for CTE (Common Table Expression) management.
 * Handles creating, removing, and querying CTEs.
 */

import type {
	CanvasCTE,
	QueryBuilderTable
} from '$lib/types';
import {
	createEmptyInnerQuery,
} from './query-builder-subqueries';
import { getQueryBuilderTable } from '$lib/utils/schema-adapter';

/**
 * Generates a unique ID for canvas elements.
 */
function generateId(): string {
	return crypto.randomUUID();
}

/**
 * Create a new CTE with default size and empty inner query.
 */
export function createCte(name: string, position: { x: number; y: number }): CanvasCTE {
	return {
		id: generateId(),
		name,
		position,
		size: { width: 300, height: 200 },
		innerQuery: createEmptyInnerQuery()
	};
}

/**
 * Get the derived columns from a CTE (columns output by its SELECT clause).
 * Used when referencing the CTE as a table.
 */
export function getCteColumns(
	cte: CanvasCTE,
	schema: QueryBuilderTable[]
): Array<{ name: string; type: string }> {
	const columns: Array<{ name: string; type: string }> = [];

	// Get columns from selected columns in CTE's tables
	for (const table of cte.innerQuery.tables) {
		const tableSchema = getQueryBuilderTable(schema, table.tableName);
		if (!tableSchema) continue;

		for (const colName of table.selectedColumns) {
			const col = tableSchema.columns.find((c) => c.name === colName);
			if (col) {
				const agg = table.columnAggregates.get(colName);
				if (agg) {
					columns.push({
						name: agg.alias || `${agg.function.toLowerCase()}_${colName}`,
						type: 'numeric'
					});
				} else {
					columns.push({ name: col.name, type: col.type });
				}
			}
		}
	}

	// Add standalone aggregates from the CTE
	for (const agg of cte.innerQuery.selectAggregates) {
		columns.push({
			name: agg.alias || `${agg.function.toLowerCase()}_${agg.expression.replace(/[^a-zA-Z0-9]/g, '_')}`,
			type: 'numeric'
		});
	}

	// If no columns selected, treat it as SELECT * (all columns from first table)
	if (columns.length === 0 && cte.innerQuery.tables.length > 0) {
		const firstTable = cte.innerQuery.tables[0];
		const tableSchema = getQueryBuilderTable(schema, firstTable.tableName);
		if (tableSchema) {
			for (const col of tableSchema.columns) {
				columns.push({ name: col.name, type: col.type });
			}
		}
	}

	return columns;
}
