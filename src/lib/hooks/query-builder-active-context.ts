/**
 * Pure functions for active context clause operations.
 * These operate on generic arrays (filters, groupBy, having, orderBy, selectAggregates)
 * regardless of whether they belong to a CTE, subquery, or top-level query.
 */

import type {
	FilterCondition,
	FilterOperator,
	GroupByCondition,
	HavingCondition,
	HavingOperator,
	AggregateFunction,
	SortCondition,
	SortDirection,
	SelectAggregate,
	CanvasTable,
	CanvasSubquery,
	SubqueryInnerState,
	SubqueryRole
} from '$lib/types';
import { createEmptyInnerQuery } from './query-builder-subqueries';

/**
 * Generates a unique ID for canvas elements.
 */
function generateId(): string {
	return crypto.randomUUID();
}

// === FILTER OPERATIONS ===

export function createFilter(
	column: string,
	operator: FilterOperator,
	value: string,
	connector: 'AND' | 'OR' = 'AND'
): FilterCondition {
	return { id: generateId(), column, operator, value, connector };
}

export function addItemToArray<T>(array: T[], item: T): T[] {
	return [...array, item];
}

export function updateItemInArray<T extends { id: string }>(
	array: T[],
	id: string,
	updates: Partial<Omit<T, 'id'>>
): T[] {
	return array.map((item) => (item.id === id ? { ...item, ...updates } : item));
}

export function removeItemFromArray<T extends { id: string }>(array: T[], id: string): T[] {
	return array.filter((item) => item.id !== id);
}

// === GROUP BY OPERATIONS ===

export function createGroupBy(column: string): GroupByCondition {
	return { id: generateId(), column };
}

// === HAVING OPERATIONS ===

export function createHaving(
	aggregateFunction: AggregateFunction,
	column: string,
	operator: HavingOperator,
	value: string,
	connector: 'AND' | 'OR' = 'AND'
): HavingCondition {
	return { id: generateId(), aggregateFunction, column, operator, value, connector };
}

// === ORDER BY OPERATIONS ===

export function createOrderBy(column: string, direction: SortDirection = 'ASC'): SortCondition {
	return { id: generateId(), column, direction };
}

// === SELECT AGGREGATE OPERATIONS ===

export function createSelectAggregate(
	func: AggregateFunction,
	expression: string,
	alias?: string
): SelectAggregate {
	return { id: generateId(), function: func, expression, alias };
}

// === SUBQUERY OPERATIONS ===

export function createActiveSubquery(
	role: SubqueryRole,
	position: { x: number; y: number },
	linkedFilterId?: string
): CanvasSubquery {
	return {
		id: generateId(),
		position,
		size: { width: 300, height: 200 },
		role,
		linkedFilterId,
		innerQuery: createEmptyInnerQuery()
	};
}

// === COLUMN AGGREGATE OPERATIONS ===

export function setColumnAggregateOnTable(
	tables: CanvasTable[],
	tableId: string,
	column: string,
	func: AggregateFunction | null,
	alias?: string
): boolean {
	const table = tables.find((t) => t.id === tableId);
	if (!table) return false;

	if (func === null) {
		table.columnAggregates.delete(column);
	} else {
		table.columnAggregates.set(column, { function: func, alias });
	}
	return true;
}
