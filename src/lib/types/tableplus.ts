import type { DatabaseType } from "$lib/types";

/**
 * TablePlus connection as stored in the Connections.plist file
 */
export interface TablePlusConnection {
	id: string;
	connectionName: string;
	driver: string;
	databaseHost: string;
	databasePort: string;
	databaseName: string;
	databaseUser: string;
}

/**
 * A TablePlus connection that has been processed and is ready for import
 */
export interface TablePlusImportableConnection {
	original: TablePlusConnection;
	name: string;
	type: DatabaseType;
	host: string;
	port: number;
	databaseName: string;
	username: string;
	isDuplicate: boolean;
	selected: boolean;
}
