/**
 * localStorage-backed schema cache for fast reconnects.
 *
 * Caches the table-level schema list (names + column metadata when available)
 * per unique database endpoint. On connect, cached data is shown immediately
 * while a fresh fetch runs in the background.
 *
 * The cache key is derived from type:host:port:databaseName so that switching
 * logical databases within the same cluster uses separate cache entries.
 */
import type { SchemaTable } from "$lib/types";
import type { DatabaseConnection } from "$lib/types";

const SCHEMA_CACHE_PREFIX = "seaquel:schema-cache:v1:";

interface CachedSchema {
	version: number;
	timestamp: number;
	schemas: SchemaTable[];
}

const CACHE_VERSION = 1;

type ConnectionFingerprint = Pick<DatabaseConnection, "type" | "host" | "port" | "databaseName">;

function makeKey(conn: ConnectionFingerprint): string {
	return `${SCHEMA_CACHE_PREFIX}${conn.type}:${conn.host}:${conn.port}:${conn.databaseName}`;
}

/**
 * Returns cached schema data for a connection, or null if no cache exists.
 * Stale entries (wrong version) are silently removed.
 */
export function getCachedSchema(conn: ConnectionFingerprint): SchemaTable[] | null {
	try {
		const raw = localStorage.getItem(makeKey(conn));
		if (!raw) return null;
		const cached = JSON.parse(raw) as CachedSchema;
		if (cached.version !== CACHE_VERSION) {
			localStorage.removeItem(makeKey(conn));
			return null;
		}
		return cached.schemas;
	} catch {
		return null;
	}
}

/**
 * Persists schema data to localStorage. Silently ignores quota / serialization
 * errors — the cache is a best-effort optimization, not a correctness requirement.
 */
export function setCachedSchema(conn: ConnectionFingerprint, schemas: SchemaTable[]): void {
	try {
		const entry: CachedSchema = {
			version: CACHE_VERSION,
			timestamp: Date.now(),
			schemas,
		};
		localStorage.setItem(makeKey(conn), JSON.stringify(entry));
	} catch {
		// localStorage quota exceeded or serialization error — silently ignore
	}
}

/**
 * Removes cached schema data for a connection.
 */
export function clearCachedSchema(conn: ConnectionFingerprint): void {
	try {
		localStorage.removeItem(makeKey(conn));
	} catch {
		// ignore
	}
}
