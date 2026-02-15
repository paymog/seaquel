import { readTablePlusConfig } from "$lib/api/tauri";
import type { DatabaseType } from "$lib/types";
import type {
	TablePlusConnection,
	TablePlusImportableConnection,
} from "$lib/types/tableplus";

/**
 * Maps TablePlus driver names to Seaquel database types
 */
const DRIVER_MAP: Record<string, DatabaseType> = {
	PostgreSQL: "postgres",
	MySQL: "mysql",
	MariaDB: "mariadb",
	SQLite: "sqlite",
	"SQL Server": "mssql",
};

/**
 * Default ports for each database type
 */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
	postgres: 5432,
	mysql: 3306,
	mariadb: 3306,
	sqlite: 0,
	mssql: 1433,
	duckdb: 0,
};

/**
 * Reads and parses TablePlus Connections.plist using a Rust command.
 * The Rust side converts the plist to JSON before returning.
 * Returns an array of connections or empty array if not found.
 */
export async function parseTablePlusConnections(): Promise<TablePlusConnection[]> {
	try {
		const content = await readTablePlusConfig();

		if (!content) {
			return [];
		}

		const data = JSON.parse(content) as Record<string, unknown>[];

		if (!Array.isArray(data)) {
			return [];
		}

		return data
			.filter((entry): entry is Record<string, string> => {
				return typeof entry === "object" && entry !== null && "ID" in entry;
			})
			.map((entry) => ({
				id: String(entry.ID || ""),
				connectionName: String(entry.ConnectionName || ""),
				driver: String(entry.Driver || ""),
				databaseHost: String(entry.DatabaseHost || ""),
				databasePort: String(entry.DatabasePort || ""),
				databaseName: String(entry.DatabaseName || ""),
				databaseUser: String(entry.DatabaseUser || ""),
			}));
	} catch (error) {
		console.error("Failed to read TablePlus config:", error);
		return [];
	}
}

/**
 * Maps a TablePlus connection to an importable connection format.
 * Returns null if the database type is not supported.
 */
export function mapToImportable(
	conn: TablePlusConnection,
	existingConnectionIds: string[]
): TablePlusImportableConnection | null {
	const type = DRIVER_MAP[conn.driver];
	if (!type) {
		return null; // Unsupported database type
	}

	const host = conn.databaseHost || "localhost";
	const port = parseInt(conn.databasePort || String(DEFAULT_PORTS[type]), 10);
	const databaseName = conn.databaseName || "";
	const username = conn.databaseUser || "";

	// Generate the connection ID that Seaquel would use
	const expectedId =
		type === "sqlite"
			? `conn-sqlite-${databaseName}`
			: `conn-${host}-${port}`;

	const isDuplicate = existingConnectionIds.includes(expectedId);

	return {
		original: conn,
		name: conn.connectionName || `${host}:${port}`,
		type,
		host,
		port,
		databaseName,
		username,
		isDuplicate,
		selected: !isDuplicate, // Pre-select non-duplicates
	};
}

/**
 * Discovers and parses all TablePlus connections, filtering for supported types
 */
export async function discoverTablePlusConnections(
	existingConnectionIds: string[]
): Promise<TablePlusImportableConnection[]> {
	const tablePlusConnections = await parseTablePlusConnections();

	return tablePlusConnections
		.map((conn) => mapToImportable(conn, existingConnectionIds))
		.filter((conn): conn is TablePlusImportableConnection => conn !== null);
}
