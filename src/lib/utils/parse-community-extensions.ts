import type { CommunityExtension } from "$lib/types";

/**
 * Parse the DuckDB community extensions HTML page into structured data.
 * Source: https://duckdb.org/community_extensions/list_of_extensions
 */
export function parseCommunityExtensionsHtml(html: string): CommunityExtension[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = doc.querySelectorAll("tbody tr");
  const extensions: CommunityExtension[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) continue;

    const nameEl = cells[0].querySelector("a");
    const name = (nameEl?.textContent ?? cells[0].textContent ?? "").trim();
    if (!name) continue;

    const githubEl = cells[1].querySelector("a");
    const github_url = githubEl?.getAttribute("href") ?? "";

    const description = (cells[2].textContent ?? "").trim();

    if (!seen.has(name)) {
      seen.add(name);
      extensions.push({ name, description, github_url });
    }
  }

  return extensions;
}
