import type { CanvasJoin, FilterCondition, SortCondition } from "$lib/types";

/**
 * Compute the cleanup needed when removing a table from the canvas.
 * Filters out joins, filters, and orderBy clauses that reference the given table.
 */
export function computeTableRemovalCleanup(
  tableName: string,
  joins: CanvasJoin[],
  filters: FilterCondition[],
  orderBy: SortCondition[],
): { joins: CanvasJoin[]; filters: FilterCondition[]; orderBy: SortCondition[] } {
  return {
    joins: joins.filter((j) => j.sourceTable !== tableName && j.targetTable !== tableName),
    filters: filters.filter((f) => !f.column.startsWith(`${tableName}.`)),
    orderBy: orderBy.filter((o) => !o.column.startsWith(`${tableName}.`)),
  };
}
