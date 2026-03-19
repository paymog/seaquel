/**
 * Manages shared connection templates: merging templates with personal overrides
 * and keychain credentials to produce runtime DatabaseConnection objects.
 */

import type {
  SharedConnection,
  SharedProject,
  ConnectionOverride,
  DatabaseConnection,
} from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { PersistenceManager } from "./persistence-manager.svelte.js";
import { getKeyringService } from "$lib/services/keyring";

/**
 * Groups shared connections by project for display.
 */
export interface SharedConnectionGroup {
  project: SharedProject;
  connections: SharedConnection[];
}

export class SharedConnectionManager {
  constructor(
    private state: DatabaseState,
    private persistence: PersistenceManager,
  ) {}

  /**
   * Load all connection overrides from storage into state.
   */
  async loadOverrides(): Promise<void> {
    this.state.connectionOverrides = await this.persistence.loadConnectionOverrides();
  }

  /**
   * Get all shared connections grouped by project, optionally filtered by repo.
   */
  getConnectionsByProject(repoId?: string): SharedConnectionGroup[] {
    const projects = repoId
      ? (this.state.sharedProjectsByRepo[repoId] ?? [])
      : this.state.allSharedProjects;

    return projects.map((project) => ({
      project,
      connections: this.state.sharedConnectionsByProject[project.id] ?? [],
    }));
  }

  /**
   * Get the personal override for a shared connection.
   */
  getOverride(sharedConnectionId: string): ConnectionOverride | undefined {
    return this.state.connectionOverrides[sharedConnectionId];
  }

  /**
   * Save a personal override for a shared connection.
   */
  async saveOverride(override: ConnectionOverride): Promise<void> {
    this.state.connectionOverrides = {
      ...this.state.connectionOverrides,
      [override.sharedConnectionId]: override,
    };
    await this.persistence.persistConnectionOverride(override);
  }

  /**
   * Remove a personal override for a shared connection.
   */
  async removeOverride(sharedConnectionId: string): Promise<void> {
    const { [sharedConnectionId]: _, ...remaining } = this.state.connectionOverrides;
    this.state.connectionOverrides = remaining;
    await this.persistence.removeConnectionOverride(sharedConnectionId);
  }

  /**
   * Merge a shared connection template with personal overrides and keychain
   * credentials to produce a runtime DatabaseConnection ready for connecting.
   *
   * @param sharedConnection - The shared template from Git
   * @param projectId - Local project ID to assign the connection to
   * @param credentials - Runtime credentials (password, SSH password, etc.)
   * @returns A DatabaseConnection ready for the ConnectionManager
   */
  async buildRuntimeConnection(
    sharedConnection: SharedConnection,
    projectId: string,
    credentials?: {
      username: string;
      password?: string;
      sshPassword?: string;
      sshKeyPassphrase?: string;
    },
  ): Promise<DatabaseConnection> {
    const override = this.state.connectionOverrides[sharedConnection.id];

    // Try to load saved password from keychain
    let password = credentials?.password ?? "";
    if (!password && override?.savePassword) {
      const keyring = getKeyringService();
      if (keyring.isAvailable()) {
        try {
          password = (await keyring.getDbPassword(sharedConnection.id)) ?? "";
        } catch {
          // Keychain access failed
        }
      }
    }

    const connection: DatabaseConnection = {
      id: `shared-${sharedConnection.id}-${crypto.randomUUID()}`,
      name: sharedConnection.name,
      type: sharedConnection.type,
      host: override?.hostOverride ?? sharedConnection.host,
      port: override?.portOverride ?? sharedConnection.port,
      databaseName: sharedConnection.databaseName,
      username: credentials?.username ?? override?.username ?? "",
      password,
      sslMode: sharedConnection.sslMode,
      projectId,
      labelIds: [],
      sharedConnectionId: sharedConnection.id,
    };

    // Add SSH tunnel config if present
    if (sharedConnection.sshTunnel?.enabled) {
      connection.sshTunnel = {
        enabled: true,
        host: sharedConnection.sshTunnel.host,
        port: sharedConnection.sshTunnel.port,
        username: credentials?.username ?? override?.username ?? "",
        authMethod: "key",
      };
    }

    return connection;
  }

  /**
   * Save credentials for a shared connection to the keychain.
   */
  async saveCredentials(
    sharedConnectionId: string,
    credentials: {
      password?: string;
      sshPassword?: string;
      sshKeyPassphrase?: string;
    },
    saveFlags: {
      savePassword?: boolean;
      saveSshPassword?: boolean;
      saveSshKeyPassphrase?: boolean;
    },
  ): Promise<void> {
    const keyring = getKeyringService();
    if (!keyring.isAvailable()) return;

    try {
      if (saveFlags.savePassword && credentials.password) {
        await keyring.setDbPassword(sharedConnectionId, credentials.password);
      }
      if (saveFlags.saveSshPassword && credentials.sshPassword) {
        await keyring.setSshPassword(sharedConnectionId, credentials.sshPassword);
      }
      if (saveFlags.saveSshKeyPassphrase && credentials.sshKeyPassphrase) {
        await keyring.setSshKeyPassphrase(sharedConnectionId, credentials.sshKeyPassphrase);
      }
    } catch (error) {
      console.warn("Failed to save credentials to keychain:", error);
    }
  }

  /**
   * Find a shared connection by ID across all projects.
   */
  findSharedConnection(sharedConnectionId: string): SharedConnection | undefined {
    return this.state.allSharedConnections.find((c) => c.id === sharedConnectionId);
  }

  /**
   * Check if a shared connection has saved credentials.
   */
  hasSavedCredentials(sharedConnectionId: string): boolean {
    const override = this.state.connectionOverrides[sharedConnectionId];
    return !!(override?.username || override?.savePassword);
  }
}
