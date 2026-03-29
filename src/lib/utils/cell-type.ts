export type CellType =
  | "null"
  | "boolean"
  | "integer"
  | "float"
  | "date"
  | "datetime"
  | "time"
  | "uuid"
  | "json"
  | "array"
  | "binary"
  | "long_text"
  | "text";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2}(:\d{2})?)?$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const LONG_TEXT_THRESHOLD = 100;

export function detectCellType(value: unknown): CellType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "json";
  if (typeof value === "string") {
    if (UUID_RE.test(value)) return "uuid";
    if (DATE_RE.test(value)) return "date";
    if (DATETIME_RE.test(value)) return "datetime";
    if (TIME_RE.test(value)) return "time";
    if (value.length > LONG_TEXT_THRESHOLD) return "long_text";
    return "text";
  }
  return "text";
}

export function detectColumnTypes(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, CellType> {
  const result: Record<string, CellType> = {};
  const sampleSize = 5;

  for (const column of columns) {
    const typeCounts = new Map<CellType, number>();
    let sampled = 0;

    for (const row of rows) {
      if (sampled >= sampleSize) break;
      const val = row[column];
      if (val === null || val === undefined) continue;
      const type = detectCellType(val);
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      sampled++;
    }

    if (typeCounts.size === 0) {
      result[column] = "null";
    } else {
      let maxCount = 0;
      let maxType: CellType = "text";
      for (const [type, count] of typeCounts) {
        if (count > maxCount) {
          maxCount = count;
          maxType = type;
        }
      }
      result[column] = maxType;
    }
  }

  return result;
}

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 10,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

export function formatDate(s: string): string {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return s;
  return dateFormatter.format(d);
}

export function formatDateTime(s: string): string {
  const d = new Date(normalizeDatetime(s));
  if (isNaN(d.getTime())) return s;
  return dateTimeFormatter.format(d);
}

/**
 * Normalize PostgreSQL-style timestamps like "2026-02-15 21:40:23.568684 +00:00:00"
 * into a format that `new Date()` can parse.
 */
function normalizeDatetime(s: string): string {
  // Replace space separator with T for ISO compatibility
  let normalized = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2");
  // Remove the seconds part from timezone offset (+00:00:00 → +00:00)
  normalized = normalized.replace(/\s*([+-]\d{2}:\d{2}):\d{2}$/, "$1");
  return normalized;
}

export function formatTime(s: string): string {
  const d = new Date(`1970-01-01T${s}`);
  if (isNaN(d.getTime())) return s;
  return timeFormatter.format(d);
}

export function formatByteSize(s: string): string {
  // Estimate decoded size from base64 length
  const bytes = Math.ceil((s.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateText(s: string, max: number = 50): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function stringify(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value as string | number | bigint | boolean | symbol);
}

/**
 * Returns the display text for a cell value given its detected type.
 * Used for estimating column widths.
 */
export function getFormattedCellText(value: unknown, columnType: CellType): string {
  if (value === null || value === undefined) return "NULL";
  if (columnType === "boolean") return "false"; // checkbox, fixed width
  if (columnType === "integer" || columnType === "float") return formatNumber(Number(value));
  if (columnType === "date") return formatDate(stringify(value));
  if (columnType === "datetime") return formatDateTime(stringify(value));
  if (columnType === "time") return formatTime(stringify(value));
  if (columnType === "uuid") return stringify(value);
  if (columnType === "json")
    return truncateText(typeof value === "object" ? JSON.stringify(value) : stringify(value));
  if (columnType === "array" && Array.isArray(value))
    return value.slice(0, 3).join("  ") + (value.length > 3 ? `  +${value.length - 3}` : "");
  if (columnType === "binary") return formatByteSize(stringify(value));
  if (columnType === "long_text") return truncateText(stringify(value), 80);
  return stringify(value);
}
