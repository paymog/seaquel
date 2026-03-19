/**
 * Parser for .seaquel/ config files (YAML format).
 *
 * Handles:
 * - labels.yaml — repo-wide label definitions
 * - project.yaml — project metadata
 * - connections/*.yaml — connection templates (credentials stripped)
 *
 * Uses the same lightweight YAML approach as query-file-parser.ts
 * to avoid external library dependencies.
 */

import type {
  SharedLabels,
  SharedProject,
  SharedConnection,
  SharedSSHTunnelConfig,
  DatabaseType,
} from "$lib/types";
import type { ConnectionLabel } from "$lib/types/project";
import { CREDENTIAL_FIELDS } from "$lib/types";
import { parseYamlValue, parseYamlArray, escapeYamlString } from "./yaml-utils";

/**
 * Parse a labels.yaml file into SharedLabels.
 *
 * Expected format:
 * ```yaml
 * labels:
 *   - name: Development
 *     color: "#22c55e"
 *   - name: Production
 *     color: "#ef4444"
 * ```
 */
export function parseLabelsFile(content: string): SharedLabels {
  const labels: ConnectionLabel[] = [];
  const lines = content.split("\n");

  let inLabels = false;
  let currentLabel: Partial<ConnectionLabel> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level "labels:" key
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch && keyMatch[1] === "labels") {
      inLabels = true;
      continue;
    }

    if (!inLabels) continue;

    // Back to top-level key — stop
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    // New label item (starts with -)
    const itemStart = line.match(/^\s+-\s*(\w+):\s*(.*)$/);
    if (itemStart) {
      if (currentLabel?.name) {
        labels.push(finalizeLabel(currentLabel));
      }
      currentLabel = {};
      setLabelField(currentLabel, itemStart[1], itemStart[2].trim());
      continue;
    }

    // Continuation of current label
    const continuation = line.match(/^\s+(\w+):\s*(.*)$/);
    if (continuation && currentLabel) {
      setLabelField(currentLabel, continuation[1], continuation[2].trim());
    }
  }

  // Don't forget last label
  if (currentLabel?.name) {
    labels.push(finalizeLabel(currentLabel));
  }

  return { labels };
}

function setLabelField(label: Partial<ConnectionLabel>, key: string, value: string): void {
  const parsed = parseYamlValue(value);
  if (key === "name") {
    label.name = parsed;
  } else if (key === "color") {
    label.color = parsed;
  }
}

function finalizeLabel(partial: Partial<ConnectionLabel>): ConnectionLabel {
  return {
    id: `shared-${(partial.name ?? "").toLowerCase().replace(/\s+/g, "-")}`,
    name: partial.name ?? "",
    isPredefined: false,
    color: partial.color ?? "#6b7280",
  };
}

/**
 * Parse a project.yaml file into partial SharedProject fields.
 *
 * Expected format:
 * ```yaml
 * name: Staging
 * description: Staging environment databases
 * ```
 */
export function parseProjectFile(content: string, repoId: string, dirName: string): SharedProject {
  const lines = content.split("\n");
  let name = dirName; // fallback to directory name
  let description: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = parseYamlValue(keyMatch[2].trim());

      if (key === "name") {
        name = value;
      } else if (key === "description") {
        description = value || undefined;
      }
    }
  }

  return {
    id: `${repoId}:.seaquel/projects/${dirName}`,
    repoId,
    name,
    description,
    dirName,
    connections: [],
  };
}

/**
 * Parse a connection YAML file into a SharedConnection.
 * Actively strips any credential fields for security.
 *
 * Expected format:
 * ```yaml
 * name: App Database
 * type: postgres
 * host: staging-db.internal.company.com
 * port: 5432
 * databaseName: myapp_staging
 * sslMode: require
 * labels: [Staging]
 * sshTunnel:
 *   enabled: true
 *   host: bastion.company.com
 *   port: 22
 * ```
 */
export function parseConnectionFile(
  content: string,
  repoId: string,
  projectId: string,
  filePath: string,
): SharedConnection | null {
  const lines = content.split("\n");
  const fields: Record<string, string> = {};
  let sshTunnel: Partial<SharedSSHTunnelConfig> | null = null;
  let inSshTunnel = false;
  let labels: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level key
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim();

      // Skip credential fields
      if ((CREDENTIAL_FIELDS as readonly string[]).includes(key)) {
        inSshTunnel = false;
        continue;
      }

      if (key === "sshTunnel") {
        inSshTunnel = true;
        sshTunnel = {};
        continue;
      }

      inSshTunnel = false;

      if (key === "labels") {
        labels = parseYamlArray(value);
        continue;
      }

      fields[key] = parseYamlValue(value);
      continue;
    }

    // SSH tunnel sub-fields
    if (inSshTunnel) {
      const subMatch = line.match(/^\s+(\w+):\s*(.*)$/);
      if (subMatch) {
        const subKey = subMatch[1];
        const subValue = subMatch[2].trim();

        // Strip credential fields from SSH tunnel too
        if ((CREDENTIAL_FIELDS as readonly string[]).includes(subKey)) {
          continue;
        }

        if (!sshTunnel) sshTunnel = {};

        if (subKey === "enabled") {
          sshTunnel.enabled = subValue === "true";
        } else if (subKey === "host") {
          sshTunnel.host = parseYamlValue(subValue);
        } else if (subKey === "port") {
          sshTunnel.port = parseInt(subValue, 10) || 22;
        }
      }
    }
  }

  const name = fields.name;
  if (!name) return null;

  const type = (fields.type ?? "postgres") as DatabaseType;

  return {
    id: `${repoId}:${filePath}`,
    repoId,
    projectId,
    filePath,
    name,
    type,
    host: fields.host ?? "localhost",
    port: parseInt(fields.port, 10) || getDefaultPort(type),
    databaseName: fields.databaseName ?? "",
    sslMode: fields.sslMode || undefined,
    sshTunnel: sshTunnel?.enabled ? (sshTunnel as SharedSSHTunnelConfig) : undefined,
    labels,
  };
}

/**
 * Serialize SharedLabels to YAML for labels.yaml.
 */
export function serializeLabelsFile(shared: SharedLabels): string {
  const lines: string[] = ["labels:"];

  for (const label of shared.labels) {
    lines.push(`  - name: ${escapeYamlString(label.name)}`);
    lines.push(`    color: "${label.color}"`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Serialize a SharedProject to YAML for project.yaml.
 */
export function serializeProjectFile(project: SharedProject): string {
  const lines: string[] = [];

  lines.push(`name: ${escapeYamlString(project.name)}`);
  if (project.description) {
    lines.push(`description: ${escapeYamlString(project.description)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Serialize a SharedConnection to YAML for a connection file.
 * Credentials are NEVER included.
 */
export function serializeConnectionFile(connection: SharedConnection): string {
  const lines: string[] = [];

  lines.push(`name: ${escapeYamlString(connection.name)}`);
  lines.push(`type: ${connection.type}`);
  lines.push(`host: ${escapeYamlString(connection.host)}`);
  lines.push(`port: ${connection.port}`);
  lines.push(`databaseName: ${escapeYamlString(connection.databaseName)}`);

  if (connection.sslMode) {
    lines.push(`sslMode: ${connection.sslMode}`);
  }

  if (connection.labels.length > 0) {
    const labelsStr = connection.labels.map((l) => escapeYamlString(l)).join(", ");
    lines.push(`labels: [${labelsStr}]`);
  }

  if (connection.sshTunnel?.enabled) {
    lines.push("sshTunnel:");
    lines.push(`  enabled: true`);
    lines.push(`  host: ${escapeYamlString(connection.sshTunnel.host)}`);
    lines.push(`  port: ${connection.sshTunnel.port}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Validate that a config file path is safe (no path traversal, within .seaquel/).
 */
export function isValidConfigPath(filePath: string): boolean {
  if (filePath.includes("..")) return false;
  if (!filePath.startsWith(".seaquel/")) return false;

  const parts = filePath.split("/");
  for (const part of parts) {
    // Allow .seaquel itself but no other hidden dirs/files
    if (part.startsWith(".") && part !== ".seaquel") return false;
  }

  return filePath.endsWith(".yaml") || filePath.endsWith(".yml");
}

/**
 * Generate a safe filename from a name string.
 */
export function nameToFilename(name: string): string {
  const result = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return result || "untitled";
}

// === Internal helpers ===

function getDefaultPort(type: DatabaseType): number {
  switch (type) {
    case "postgres":
      return 5432;
    case "mysql":
    case "mariadb":
      return 3306;
    case "mssql":
      return 1433;
    default:
      return 5432;
  }
}
