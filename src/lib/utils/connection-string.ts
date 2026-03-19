import type { ConnectionFormData } from "$lib/types";
import { databaseTypes } from "$lib/stores/connection-wizard.svelte.js";
import { getKeyringService } from "$lib/services/keyring";

/**
 * Build a connection string from form data.
 */
export function buildConnectionString(formData: ConnectionFormData): string {
  const data = formData;

  if (data.type === "sqlite") {
    return `sqlite://${data.databaseName}`;
  }

  if (data.type === "duckdb") {
    return `duckdb://${data.databaseName || ":memory:"}`;
  }

  const credentials = data.username
    ? `${encodeURIComponent(data.username)}${data.password ? `:${encodeURIComponent(data.password)}` : ""}@`
    : "";

  const selectedDbType = databaseTypes.find((t) => t.value === data.type);
  const protocol = selectedDbType?.protocol[0] || data.type;
  const port = data.port !== selectedDbType?.defaultPort ? `:${data.port}` : "";

  let connectionString = `${protocol}://${credentials}${data.host}${port}/${data.databaseName}`;

  // Add sslmode parameter for PostgreSQL and MySQL
  // Always include sslmode to be explicit (driver may default to TLS otherwise)
  if (
    (data.type === "postgres" || data.type === "mysql" || data.type === "mariadb") &&
    data.sslMode
  ) {
    const separator = connectionString.includes("?") ? "&" : "?";
    const isMysql = data.type === "mysql" || data.type === "mariadb";
    const sslParam = isMysql ? "ssl-mode" : "sslmode";
    // MySQL uses uppercase values: DISABLED, PREFERRED, REQUIRED, VERIFY_CA, VERIFY_IDENTITY
    const mysqlSslMap: Record<string, string> = {
      disable: "DISABLED",
      allow: "PREFERRED",
      prefer: "PREFERRED",
      require: "REQUIRED",
    };
    const sslValue = isMysql ? mysqlSslMap[data.sslMode] || data.sslMode : data.sslMode;
    connectionString += `${separator}${sslParam}=${sslValue}`;
  }

  return connectionString;
}

/**
 * Get connection data object from form data, suitable for passing to db.connections.add/reconnect/update.
 */
export function getConnectionData(formData: ConnectionFormData) {
  let connString = formData.connectionString;
  if (connString) {
    connString = connString.replace("postgresql://", "postgres://");
  } else {
    connString = buildConnectionString(formData);
  }

  if (!connString || connString.split(":").length !== 3) {
    connString = buildConnectionString(formData);
  }

  const keyring = getKeyringService();
  const keychainAvailable = keyring.isAvailable();

  return {
    name: formData.name,
    type: formData.type,
    host: formData.host,
    port: formData.port,
    databaseName: formData.databaseName,
    username: formData.username,
    password: formData.password,
    sslMode: formData.sslMode,
    connectionString: connString,
    sshTunnel: formData.sshEnabled
      ? {
          enabled: true,
          host: formData.sshHost,
          port: formData.sshPort,
          username: formData.sshUsername,
          authMethod: formData.sshAuthMethod,
          keyPath: formData.sshKeyPath || undefined,
        }
      : undefined,
    sshPassword: formData.sshPassword,
    sshKeyPath: formData.sshKeyPath,
    sshKeyPassphrase: formData.sshKeyPassphrase,
    // Password storage flags (only if keychain is available)
    savePassword: keychainAvailable ? formData.savePassword : false,
    saveSshPassword: keychainAvailable ? formData.saveSshPassword : false,
    saveSshKeyPassphrase: keychainAvailable ? formData.saveSshKeyPassphrase : false,
  };
}

/**
 * Parse a connection string and populate form data fields.
 * Returns the updated form data fields on success, or an error string on failure.
 */
export function parseConnectionString(
  connStr: string,
): { success: true; formData: Partial<ConnectionFormData> } | { success: false; error: string } {
  try {
    // Handle SQLite
    if (connStr.startsWith("sqlite://") || connStr.startsWith("sqlite:")) {
      const dbPath = connStr.replace(/^sqlite:\/\//, "").replace(/^sqlite:/, "");
      return {
        success: true,
        formData: {
          type: "sqlite",
          databaseName: dbPath,
          name: `SQLite - ${dbPath.split("/").pop() || "database"}`,
        },
      };
    }

    // Handle DuckDB
    if (connStr.startsWith("duckdb://") || connStr.startsWith("duckdb:")) {
      const dbPath = connStr.replace(/^duckdb:\/\//, "").replace(/^duckdb:/, "");
      const isMemory = dbPath === ":memory:" || dbPath === "";
      return {
        success: true,
        formData: {
          type: "duckdb",
          databaseName: dbPath || ":memory:",
          name: isMemory
            ? "DuckDB - In-Memory"
            : `DuckDB - ${dbPath.split("/").pop() || "database"}`,
        },
      };
    }

    // Normalize postgresql to postgres
    connStr = connStr.replace("postgresql://", "postgres://");

    // Parse as URL
    const url = new URL(connStr);
    const protocol = url.protocol.replace(":", "");
    const dbType = databaseTypes.find((t) => t.protocol.includes(protocol));

    if (!dbType) {
      return { success: false, error: `Unsupported database type: ${protocol}` };
    }

    const parsedName = url.pathname.replace(/^\//, "") || `${dbType.label} Connection`;

    // Parse SSL mode from query parameters
    const sslModeParam = url.searchParams.get("sslmode") || url.searchParams.get("ssl-mode");

    return {
      success: true,
      formData: {
        type: dbType.value,
        host: url.hostname,
        port: url.port ? parseInt(url.port) : dbType.defaultPort,
        databaseName: url.pathname.replace(/^\//, ""),
        username: url.username ? decodeURIComponent(url.username) : "",
        password: url.password ? decodeURIComponent(url.password) : "",
        ...(sslModeParam ? { sslMode: sslModeParam } : {}),
        name: parsedName,
      },
    };
  } catch {
    return { success: false, error: "Invalid connection string format" };
  }
}

/**
 * Check if all required credentials are present for auto-connect.
 */
export function hasAllCredentials(formData: ConnectionFormData): boolean {
  if (!formData.name.trim()) return false;
  if (!formData.databaseName.trim()) return false;
  const isFileBasedDb = formData.type === "sqlite" || formData.type === "duckdb";
  if (!isFileBasedDb && !formData.host.trim()) return false;

  // Password requirement (SQLite and DuckDB don't need password)
  if (!isFileBasedDb && !formData.password) return false;

  // SSH requirements
  if (formData.sshEnabled) {
    if (!formData.sshHost.trim()) return false;
    if (!formData.sshUsername.trim()) return false;

    if (formData.sshAuthMethod === "password" && !formData.sshPassword) {
      return false;
    }
    if (formData.sshAuthMethod === "key" && !formData.sshKeyPath) {
      return false;
    }
  }

  return true;
}
