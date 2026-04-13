/**
 * Helpers for reading values out of columnar result rows.
 *
 * Rows are stored as `unknown[]` (positional) alongside a parallel
 * `columns: string[]`. Callers that look up values by column name go
 * through these helpers rather than paying an O(n) `indexOf` per access.
 */

/**
 * Build a `column name → position` map from a columns array.
 * Use this when you're going to read many values from many rows by
 * column name — amortizes the name→index lookup.
 */
export function makeColumnIndex(columns: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    map.set(columns[i], i);
  }
  return map;
}

/**
 * Read a single cell by column name. For more than a few lookups on
 * the same columns array, build a `makeColumnIndex` map and index
 * directly instead.
 */
export function getCell(row: unknown[], columns: string[], name: string): unknown {
  const idx = columns.indexOf(name);
  return idx === -1 ? undefined : row[idx];
}

/**
 * Materialize a columnar row back into a `Record<column, value>` object.
 * Use sparingly — this undoes the whole point of columnar storage. Reserve
 * for code paths that genuinely need a plain object (JSON export, AI context,
 * clipboard payloads, legacy callers that can't be easily refactored).
 */
export function rowToObject(row: unknown[], columns: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = row[i];
  }
  return obj;
}

/**
 * Materialize an entire columnar result set into `Record<column, value>[]`.
 * Same caveat as `rowToObject`.
 */
export function rowsToObjects(rows: unknown[][], columns: string[]): Record<string, unknown>[] {
  return rows.map((row) => rowToObject(row, columns));
}

/**
 * Return a copy of `columns` with duplicate names disambiguated by suffixing
 * `_2`, `_3`, ... (DBeaver/pgAdmin convention).
 *
 * Column positions are preserved — only the names change. Downstream code that
 * does `columns.indexOf(name)` or keys by column name (chart axes, column copy,
 * cell-type detection) relies on names being unique. Duplicates arise in
 * practice from joins like `SELECT a.id, b.id FROM a JOIN b ...`.
 *
 * The suffix is chosen so it collides with neither an original column name nor
 * a previously-assigned deduped name, so e.g. `["id", "id", "id_2"]` becomes
 * `["id", "id_3", "id_2"]` rather than re-introducing a collision.
 */
export function dedupeColumnNames(columns: string[]): string[] {
  const originals = new Set(columns);
  const used = new Set<string>();
  return columns.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let n = 2;
    let candidate = `${name}_${n}`;
    while (originals.has(candidate) || used.has(candidate)) {
      n++;
      candidate = `${name}_${n}`;
    }
    used.add(candidate);
    return candidate;
  });
}
