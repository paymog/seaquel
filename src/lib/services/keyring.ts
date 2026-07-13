/**
 * Keyring service for secure password storage using OS-native keychains.
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (GNOME Keyring, KWallet)
 *
 * Falls back to a no-op implementation in browser demo mode.
 */

import { isServer, isTauri } from "$lib/utils/environment";
import { authHeaders } from "$lib/auth/token";

const SERVICE = "app.seaquel.desktop";

export interface KeyringService {
  setDbPassword(connectionId: string, password: string): Promise<void>;
  getDbPassword(connectionId: string): Promise<string | null>;
  deleteDbPassword(connectionId: string): Promise<void>;

  setSshPassword(connectionId: string, password: string): Promise<void>;
  getSshPassword(connectionId: string): Promise<string | null>;
  deleteSshPassword(connectionId: string): Promise<void>;

  setSshKeyPassphrase(connectionId: string, passphrase: string): Promise<void>;
  getSshKeyPassphrase(connectionId: string): Promise<string | null>;
  deleteSshKeyPassphrase(connectionId: string): Promise<void>;

  deleteAllForConnection(connectionId: string): Promise<void>;

  setLicenseKey(key: string): Promise<void>;
  getLicenseKey(): Promise<string | null>;
  deleteLicenseKey(): Promise<void>;

  setAIApiKey(key: string): Promise<void>;
  getAIApiKey(): Promise<string | null>;
  deleteAIApiKey(): Promise<void>;

  setAIApiKeyForProvider(id: string, key: string): Promise<void>;
  getAIApiKeyForProvider(id: string): Promise<string | null>;
  deleteAIApiKeyForProvider(id: string): Promise<void>;

  isAvailable(): boolean;
}

/**
 * Tauri implementation using the native keyring plugin.
 */
class TauriKeyringService implements KeyringService {
  private keyringApi: typeof import("tauri-plugin-keyring-api") | null = null;
  private initPromise: Promise<void> | null = null;

  private async init(): Promise<void> {
    if (this.keyringApi) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = import("tauri-plugin-keyring-api").then((api) => {
      this.keyringApi = api;
    });

    return this.initPromise;
  }

  async setDbPassword(connectionId: string, password: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, `db:${connectionId}`, password);
  }

  async getDbPassword(connectionId: string): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, `db:${connectionId}`);
    } catch {
      // Entry doesn't exist or keychain error
      return null;
    }
  }

  async deleteDbPassword(connectionId: string): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, `db:${connectionId}`);
    } catch {
      // Ignore - entry may not exist
    }
  }

  async setSshPassword(connectionId: string, password: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, `ssh:${connectionId}`, password);
  }

  async getSshPassword(connectionId: string): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, `ssh:${connectionId}`);
    } catch {
      return null;
    }
  }

  async deleteSshPassword(connectionId: string): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, `ssh:${connectionId}`);
    } catch {
      // Ignore
    }
  }

  async setSshKeyPassphrase(connectionId: string, passphrase: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, `ssh-key:${connectionId}`, passphrase);
  }

  async getSshKeyPassphrase(connectionId: string): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, `ssh-key:${connectionId}`);
    } catch {
      return null;
    }
  }

  async deleteSshKeyPassphrase(connectionId: string): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, `ssh-key:${connectionId}`);
    } catch {
      // Ignore
    }
  }

  async deleteAllForConnection(connectionId: string): Promise<void> {
    await Promise.all([
      this.deleteDbPassword(connectionId),
      this.deleteSshPassword(connectionId),
      this.deleteSshKeyPassphrase(connectionId),
    ]);
  }

  async setLicenseKey(key: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, "license-key", key);
  }

  async getLicenseKey(): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, "license-key");
    } catch {
      return null;
    }
  }

  async deleteLicenseKey(): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, "license-key");
    } catch {
      // Ignore - entry may not exist
    }
  }

  async setAIApiKey(key: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, "ai-api-key", key);
  }

  async getAIApiKey(): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, "ai-api-key");
    } catch {
      return null;
    }
  }

  async deleteAIApiKey(): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, "ai-api-key");
    } catch {
      // Ignore - entry may not exist
    }
  }

  async setAIApiKeyForProvider(id: string, key: string): Promise<void> {
    await this.init();
    await this.keyringApi!.setPassword(SERVICE, `ai-api-key:${id}`, key);
  }

  async getAIApiKeyForProvider(id: string): Promise<string | null> {
    await this.init();
    try {
      return await this.keyringApi!.getPassword(SERVICE, `ai-api-key:${id}`);
    } catch {
      return null;
    }
  }

  async deleteAIApiKeyForProvider(id: string): Promise<void> {
    await this.init();
    try {
      await this.keyringApi!.deletePassword(SERVICE, `ai-api-key:${id}`);
    } catch {
      // Ignore
    }
  }

  isAvailable(): boolean {
    return true;
  }
}

/**
 * No-op implementation for browser demo mode.
 */
class NoopKeyringService implements KeyringService {
  async setDbPassword(): Promise<void> {}
  async getDbPassword(): Promise<string | null> {
    return null;
  }
  async deleteDbPassword(): Promise<void> {}
  async setSshPassword(): Promise<void> {}
  async getSshPassword(): Promise<string | null> {
    return null;
  }
  async deleteSshPassword(): Promise<void> {}
  async setSshKeyPassphrase(): Promise<void> {}
  async getSshKeyPassphrase(): Promise<string | null> {
    return null;
  }
  async deleteSshKeyPassphrase(): Promise<void> {}
  async deleteAllForConnection(): Promise<void> {}
  async setLicenseKey(): Promise<void> {}
  async getLicenseKey(): Promise<string | null> {
    return null;
  }
  async deleteLicenseKey(): Promise<void> {}
  async setAIApiKey(): Promise<void> {}
  async getAIApiKey(): Promise<string | null> {
    return null;
  }
  async deleteAIApiKey(): Promise<void> {}
  async setAIApiKeyForProvider(): Promise<void> {}
  async getAIApiKeyForProvider(): Promise<string | null> {
    return null;
  }
  async deleteAIApiKeyForProvider(): Promise<void> {}
  isAvailable(): boolean {
    return false;
  }
}

/**
 * Server-side implementation using the Rust secret store HTTP API.
 * Used when running as a self-hosted web app.
 */
export class ServerKeyringService implements KeyringService {
  private baseUrl = "";
    // Auth headers attached on every request via the helper below.

  private async setSecret(key: string, value: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ key, value }),
    });
  }

  private async getSecret(key: string): Promise<string | null> {
    const res = await fetch(
      `${this.baseUrl}/api/secrets/${encodeURIComponent(key)}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  }

  private async deleteSecret(key: string): Promise<void> {
    await fetch(
      `${this.baseUrl}/api/secrets/${encodeURIComponent(key)}`,
      { method: "DELETE", headers: authHeaders() }
    );
  }

  async setDbPassword(connectionId: string, password: string): Promise<void> {
    await this.setSecret(`db:${connectionId}`, password);
  }

  async getDbPassword(connectionId: string): Promise<string | null> {
    return this.getSecret(`db:${connectionId}`);
  }

  async deleteDbPassword(connectionId: string): Promise<void> {
    await this.deleteSecret(`db:${connectionId}`);
  }

  async setSshPassword(connectionId: string, password: string): Promise<void> {
    await this.setSecret(`ssh:${connectionId}`, password);
  }

  async getSshPassword(connectionId: string): Promise<string | null> {
    return this.getSecret(`ssh:${connectionId}`);
  }

  async deleteSshPassword(connectionId: string): Promise<void> {
    await this.deleteSecret(`ssh:${connectionId}`);
  }

  async setSshKeyPassphrase(connectionId: string, passphrase: string): Promise<void> {
    await this.setSecret(`ssh-key:${connectionId}`, passphrase);
  }

  async getSshKeyPassphrase(connectionId: string): Promise<string | null> {
    return this.getSecret(`ssh-key:${connectionId}`);
  }

  async deleteSshKeyPassphrase(connectionId: string): Promise<void> {
    await this.deleteSecret(`ssh-key:${connectionId}`);
  }

  async deleteAllForConnection(connectionId: string): Promise<void> {
    await Promise.all([
      this.deleteDbPassword(connectionId),
      this.deleteSshPassword(connectionId),
      this.deleteSshKeyPassphrase(connectionId),
    ]);
  }

  async setLicenseKey(key: string): Promise<void> {
    await this.setSecret("license-key", key);
  }

  async getLicenseKey(): Promise<string | null> {
    return this.getSecret("license-key");
  }

  async deleteLicenseKey(): Promise<void> {
    await this.deleteSecret("license-key");
  }

  async setAIApiKey(key: string): Promise<void> {
    await this.setSecret("ai-api-key", key);
  }

  async getAIApiKey(): Promise<string | null> {
    return this.getSecret("ai-api-key");
  }

  async deleteAIApiKey(): Promise<void> {
    await this.deleteSecret("ai-api-key");
  }

  async setAIApiKeyForProvider(id: string, key: string): Promise<void> {
    await this.setSecret(`ai-api-key:${id}`, key);
  }

  async getAIApiKeyForProvider(id: string): Promise<string | null> {
    return this.getSecret(`ai-api-key:${id}`);
  }

  async deleteAIApiKeyForProvider(id: string): Promise<void> {
    await this.deleteSecret(`ai-api-key:${id}`);
  }

  isAvailable(): boolean {
    // The secret store now persists to disk (AES-256-GCM encrypted) and the
    // single-admin auth model gates access behind a bearer token, so it is a
    // reasonable place to store DB/SSH passwords for the self-hosted instance.
    return true;
  }
}

let keyringService: KeyringService | null = null;

/**
 * Get the keyring service instance.
 * Returns a Tauri implementation in desktop app, a server implementation
 * when self-hosted, or a no-op in browser demo.
 */
export function getKeyringService(): KeyringService {
  if (keyringService) return keyringService;

  if (isTauri()) {
    keyringService = new TauriKeyringService();
  } else if (isServer()) {
    keyringService = new ServerKeyringService();
  } else {
    keyringService = new NoopKeyringService();
  }

  return keyringService;
}
