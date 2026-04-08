/**
 * DuckDB extension management types.
 * @module types/extensions-duckdb
 */

/**
 * A DuckDB extension as returned by duckdb_extensions().
 */
export interface DuckDBExtension {
  extension_name: string;
  loaded: boolean;
  installed: boolean;
  install_path: string;
  description: string;
  aliases: string[];
  extension_version: string;
  install_mode: string;
  installed_from: string;
}

/**
 * A community extension from the DuckDB community extensions registry.
 */
export interface CommunityExtension {
  name: string;
  description: string;
  github_url: string;
}

/**
 * Represents an open DuckDB extensions management tab.
 */
export interface ExtensionsDuckdbTab {
  /** Unique tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** ID of the connection this tab manages extensions for */
  connectionId: string;
  /** Loaded extensions data */
  extensions?: DuckDBExtension[];
  /** Whether extensions are currently being loaded */
  isLoading: boolean;
  /** When the extensions were last refreshed */
  lastRefreshed?: Date;
  /** Error message if loading failed */
  error?: string;
  /** Track per-extension action in progress (extension_name -> action description) */
  actionInProgress?: Record<string, string>;
  /** Community extensions fetched from the registry */
  communityExtensions?: CommunityExtension[];
  /** Whether community extensions are currently being loaded */
  isCommunityLoading?: boolean;
  /** Error message if community extensions fetch failed */
  communityError?: string;
}
