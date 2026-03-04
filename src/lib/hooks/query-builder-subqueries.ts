/**
 * Pure functions for subquery tree operations.
 * Handles creating, finding, cloning, and mutating subquery trees.
 */

import { SvelteSet } from "svelte/reactivity";
import type {
  CanvasTable,
  CanvasSubquery,
  CanvasCTE,
  SubqueryInnerState,
  SubqueryRole,
  SelectAggregate,
  ColumnAggregate,
  AggregateFunction,
} from "$lib/types";

/**
 * Generates a unique ID for canvas elements.
 */
function generateId(): string {
  return crypto.randomUUID();
}

// === CLONE HELPERS ===

/**
 * Deep clone inner query state.
 */
export function cloneInnerQuery(inner: SubqueryInnerState): SubqueryInnerState {
  return {
    tables: inner.tables.map((t) => ({
      ...t,
      selectedColumns: new Set(t.selectedColumns),
      columnAggregates: new Map(t.columnAggregates),
    })),
    joins: [...inner.joins],
    filters: [...inner.filters],
    groupBy: [...inner.groupBy],
    having: [...inner.having],
    orderBy: [...inner.orderBy],
    limit: inner.limit,
    selectAggregates: [...inner.selectAggregates],
    subqueries: cloneSubqueries(inner.subqueries),
  };
}

/**
 * Deep clone subqueries array for snapshot.
 */
export function cloneSubqueries(subqueries: CanvasSubquery[]): CanvasSubquery[] {
  return subqueries.map((sq) => ({
    ...sq,
    position: { ...sq.position },
    size: { ...sq.size },
    innerQuery: cloneInnerQuery(sq.innerQuery),
  }));
}

/**
 * Deep clone CTEs array for snapshot.
 */
export function cloneCtes(ctes: CanvasCTE[]): CanvasCTE[] {
  return ctes.map((cte) => ({
    ...cte,
    position: { ...cte.position },
    size: { ...cte.size },
    innerQuery: cloneInnerQuery(cte.innerQuery),
  }));
}

// === FACTORY ===

/**
 * Create an empty inner query state.
 */
export function createEmptyInnerQuery(): SubqueryInnerState {
  return {
    tables: [],
    joins: [],
    filters: [],
    groupBy: [],
    having: [],
    orderBy: [],
    limit: null,
    selectAggregates: [],
    subqueries: [],
  };
}

// === FIND OPERATIONS ===

/**
 * Recursively find a subquery by ID in the subquery tree.
 */
export function findSubqueryById(
  subqueryId: string,
  subqueries: CanvasSubquery[],
): CanvasSubquery | undefined {
  for (const sq of subqueries) {
    if (sq.id === subqueryId) return sq;
    const nested = findSubqueryById(subqueryId, sq.innerQuery.subqueries);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Find the parent subquery that contains a given subquery ID.
 */
export function findParentSubquery(
  childId: string,
  subqueries: CanvasSubquery[],
  parent?: CanvasSubquery,
): CanvasSubquery | undefined {
  for (const sq of subqueries) {
    if (sq.id === childId) return parent;
    const found = findParentSubquery(childId, sq.innerQuery.subqueries, sq);
    if (found !== undefined) return found;
  }
  return undefined;
}

// === MUTATION OPERATIONS ===
// These mutate the subqueries array in-place and return whether they succeeded.

/**
 * Recursively update a subquery in the tree (in-place mutation).
 * Returns true if the subquery was found and updated.
 */
export function updateSubqueryInArray(
  subqueries: CanvasSubquery[],
  subqueryId: string,
  updater: (sq: CanvasSubquery) => Partial<CanvasSubquery>,
): boolean {
  for (let i = 0; i < subqueries.length; i++) {
    if (subqueries[i].id === subqueryId) {
      subqueries[i] = { ...subqueries[i], ...updater(subqueries[i]) };
      return true;
    }
    if (updateSubqueryInArray(subqueries[i].innerQuery.subqueries, subqueryId, updater)) {
      return true;
    }
  }
  return false;
}

/**
 * Create a new subquery with default size and empty inner query.
 */
export function createSubquery(
  role: SubqueryRole,
  position: { x: number; y: number },
  linkedFilterId?: string,
): CanvasSubquery {
  return {
    id: generateId(),
    position,
    size: { width: 300, height: 200 },
    role,
    linkedFilterId,
    innerQuery: createEmptyInnerQuery(),
  };
}

/** Estimated table node dimensions */
const TABLE_WIDTH = 220;
const TABLE_HEIGHT = 280;
const PADDING = 20;

/**
 * Create a canvas table and compute required container size expansion.
 * Returns the table and any size changes needed for the container.
 */
export function createCanvasTableForContainer(
  tableName: string,
  position: { x: number; y: number },
  containerSize: { width: number; height: number },
): { table: CanvasTable; newSize: { width: number; height: number } | null } {
  const canvasTable: CanvasTable = {
    id: generateId(),
    tableName,
    position,
    selectedColumns: new SvelteSet<string>(),
    columnAggregates: new Map<string, ColumnAggregate>(),
  };

  const requiredWidth = position.x + TABLE_WIDTH + PADDING;
  const requiredHeight = position.y + TABLE_HEIGHT + PADDING;

  let newSize: { width: number; height: number } | null = null;
  if (requiredWidth > containerSize.width || requiredHeight > containerSize.height) {
    newSize = {
      width: Math.max(containerSize.width, requiredWidth),
      height: Math.max(containerSize.height, requiredHeight),
    };
  }

  return { table: canvasTable, newSize };
}

/**
 * Remove a table and its associated joins/filters/orderBy from an inner query.
 * Mutates the inner query in-place.
 */
export function removeTableFromInnerQuery(innerQuery: SubqueryInnerState, tableId: string): void {
  const table = innerQuery.tables.find((t) => t.id === tableId);
  if (!table) return;

  const tableName = table.tableName;

  innerQuery.joins = innerQuery.joins.filter(
    (j) => j.sourceTable !== tableName && j.targetTable !== tableName,
  );
  innerQuery.filters = innerQuery.filters.filter((f) => !f.column.startsWith(`${tableName}.`));
  innerQuery.orderBy = innerQuery.orderBy.filter((o) => !o.column.startsWith(`${tableName}.`));
  innerQuery.tables = innerQuery.tables.filter((t) => t.id !== tableId);
}

/**
 * Toggle a column selection in a table within an inner query.
 * Mutates the table in-place.
 */
export function toggleColumnInTable(
  innerQuery: SubqueryInnerState,
  tableId: string,
  columnName: string,
): boolean {
  const table = innerQuery.tables.find((t) => t.id === tableId);
  if (!table) return false;

  if (table.selectedColumns.has(columnName)) {
    table.selectedColumns.delete(columnName);
    table.columnAggregates.delete(columnName);
  } else {
    table.selectedColumns.add(columnName);
  }
  return true;
}

/**
 * Add a select aggregate to an inner query.
 * Mutates the inner query in-place.
 * Returns the aggregate ID.
 */
export function addSelectAggregateToInnerQuery(
  innerQuery: SubqueryInnerState,
  func: AggregateFunction,
  expression: string,
  alias?: string,
): string {
  const aggregate: SelectAggregate = {
    id: generateId(),
    function: func,
    expression,
    alias,
  };

  innerQuery.selectAggregates = [...innerQuery.selectAggregates, aggregate];
  return aggregate.id;
}

/**
 * Create a CTE reference table for use inside a container (subquery or main canvas).
 */
export function createCteReferenceTable(
  cteName: string,
  cteId: string,
  position: { x: number; y: number },
  containerSize: { width: number; height: number },
): { table: CanvasTable; newSize: { width: number; height: number } | null } {
  const canvasTable: CanvasTable = {
    id: generateId(),
    tableName: cteName,
    position,
    selectedColumns: new SvelteSet<string>(),
    columnAggregates: new Map<string, ColumnAggregate>(),
    cteId,
  };

  const requiredWidth = position.x + TABLE_WIDTH + PADDING;
  const requiredHeight = position.y + TABLE_HEIGHT + PADDING;

  let newSize: { width: number; height: number } | null = null;
  if (requiredWidth > containerSize.width || requiredHeight > containerSize.height) {
    newSize = {
      width: Math.max(containerSize.width, requiredWidth),
      height: Math.max(containerSize.height, requiredHeight),
    };
  }

  return { table: canvasTable, newSize };
}
