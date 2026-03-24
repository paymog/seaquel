/**
 * Utilities for resolving @mentions in AI assistant messages.
 * Builds autocomplete lists and expands mentions into contextual information.
 * @module services/ai-mentions
 */

import type { SchemaTable, SavedQuery, Dashboard } from "$lib/types";

export type MentionKind = "table" | "query" | "dashboard";

export interface MentionItem {
  kind: MentionKind;
  label: string;
  searchText: string;
  /** Identifier used in the message text, e.g. "public.users" */
  token: string;
}

/**
 * Builds a flat list of mentionable items for the autocomplete popover.
 */
export function buildMentionItems(
  tables: SchemaTable[],
  savedQueries: SavedQuery[],
  dashboards: Dashboard[],
): MentionItem[] {
  const items: MentionItem[] = [];

  for (const t of tables) {
    const token = `${t.schema}.${t.name}`;
    items.push({
      kind: "table",
      label: token,
      searchText: `${t.schema} ${t.name}`.toLowerCase(),
      token,
    });
  }

  for (const q of savedQueries) {
    items.push({
      kind: "query",
      label: q.name,
      searchText: q.name.toLowerCase(),
      token: q.name,
    });
  }

  for (const d of dashboards) {
    items.push({
      kind: "dashboard",
      label: d.name,
      searchText: d.name.toLowerCase(),
      token: d.name,
    });
  }

  return items;
}

/**
 * Extracts @mention tokens from a message string.
 * Supports `@token` (no spaces) and `@"token with spaces"`.
 */
function extractMentionTokens(content: string): string[] {
  const tokens: string[] = [];
  const regex = /@"([^"]+)"|@(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }

  return tokens;
}

/**
 * Finds a table by matching `schema.name` or just `name` (case-insensitive).
 */
function findTable(tables: SchemaTable[], token: string): SchemaTable | undefined {
  const lower = token.toLowerCase();

  // Try exact schema.name match first
  const byFull = tables.find((t) => `${t.schema}.${t.name}`.toLowerCase() === lower);
  if (byFull) return byFull;

  // Fall back to name-only match
  return tables.find((t) => t.name.toLowerCase() === lower);
}

/**
 * Formats a table's schema into a human-readable block for the LLM.
 */
function formatTableContext(table: SchemaTable): string {
  const lines: string[] = [`Table: ${table.schema}.${table.name} (${table.type})`];

  if (table.columns.length > 0) {
    lines.push("Columns:");
    for (const col of table.columns) {
      const flags: string[] = [];
      if (col.isPrimaryKey) flags.push("PK");
      if (col.isForeignKey) flags.push("FK");
      if (!col.nullable) flags.push("NOT NULL");

      let line = `  - ${col.name}: ${col.type}`;
      if (flags.length > 0) line += ` [${flags.join(", ")}]`;
      if (col.isForeignKey && col.foreignKeyRef) {
        line += ` -> ${col.foreignKeyRef.referencedTable}.${col.foreignKeyRef.referencedColumn}`;
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Formats a saved query into a context block for the LLM.
 */
function formatQueryContext(query: SavedQuery): string {
  return `Saved query: ${query.name}\n\`\`\`sql\n${query.query}\n\`\`\``;
}

/**
 * Formats a dashboard into a context block for the LLM.
 */
function formatDashboardContext(dashboard: Dashboard): string {
  const lines: string[] = [`Dashboard: ${dashboard.name} (id: ${dashboard.id})`];

  if (dashboard.widgets.length > 0) {
    lines.push("Widgets:");
    for (const w of dashboard.widgets) {
      lines.push(`  - ${w.title} [id: ${w.id}] (${w.widgetType})`);
      if (w.query) {
        lines.push(`    Query: ${w.query}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Parses @mentions from the message and appends a "Referenced context:" block
 * with resolved details for tables, saved queries, and dashboards.
 *
 * If no mentions are found or none resolve, returns content unchanged.
 */
export function resolveMentions(
  content: string,
  tables: SchemaTable[],
  savedQueries: SavedQuery[],
  dashboards: Dashboard[],
): string {
  const tokens = extractMentionTokens(content);
  if (tokens.length === 0) return content;

  const seen = new Set<string>();
  const contextBlocks: string[] = [];

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Try table
    const table = findTable(tables, token);
    if (table) {
      contextBlocks.push(formatTableContext(table));
      continue;
    }

    // Try saved query
    const query = savedQueries.find((q) => q.name.toLowerCase() === key);
    if (query) {
      contextBlocks.push(formatQueryContext(query));
      continue;
    }

    // Try dashboard
    const dashboard = dashboards.find((d) => d.name.toLowerCase() === key);
    if (dashboard) {
      contextBlocks.push(formatDashboardContext(dashboard));
    }
  }

  if (contextBlocks.length === 0) return content;

  return `${content}\n\nReferenced context:\n${contextBlocks.join("\n\n")}`;
}
