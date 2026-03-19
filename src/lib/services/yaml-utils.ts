/**
 * Shared YAML utilities for the lightweight YAML parsers.
 *
 * Used by both query-file-parser.ts and config-file-parser.ts
 * to avoid duplicating identical parsing/serialization logic.
 */

/**
 * Parse a YAML value (handles quoted strings and bare values).
 */
export function parseYamlValue(value: string): string {
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a YAML inline array [tag1, tag2] or single value.
 */
export function parseYamlArray(value: string): string[] {
  if (!value) return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    return inner
      .split(",")
      .map((s) => parseYamlValue(s.trim()))
      .filter((s) => s.length > 0);
  }
  if (value) return [parseYamlValue(value)];
  return [];
}

/**
 * Escape a string for YAML if it contains special characters.
 */
export function escapeYamlString(value: string): string {
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes('"') ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.includes("[") ||
    value.includes("]")
  ) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
