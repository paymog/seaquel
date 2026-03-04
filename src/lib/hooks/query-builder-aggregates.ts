import type { CanvasTable, SelectAggregate, DisplayAggregate } from "$lib/types";

/**
 * Compute unified display aggregates from tables and standalone select aggregates.
 */
export function computeDisplayAggregates(
  tables: CanvasTable[],
  selectAggregates: SelectAggregate[],
): DisplayAggregate[] {
  const result: DisplayAggregate[] = [];

  // Collect column aggregates from tables
  for (const table of tables) {
    for (const [columnName, agg] of table.columnAggregates) {
      result.push({
        id: `col-${table.id}-${columnName}`,
        function: agg.function,
        expression: `${table.tableName}.${columnName}`,
        alias: agg.alias,
        source: "column",
        tableId: table.id,
        columnName,
      });
    }
  }

  // Add standalone select aggregates
  for (const agg of selectAggregates) {
    result.push({
      id: agg.id,
      function: agg.function,
      expression: agg.expression,
      alias: agg.alias,
      source: "select",
    });
  }

  return result;
}
