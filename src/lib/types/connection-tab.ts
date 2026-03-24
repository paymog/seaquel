import type { DatabaseType, SSHAuthMethod } from "./database";

export type ConnectionTabMode = "wizard" | "reconnect" | "edit";

export interface ConnectionFormData {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: string;
  connectionString: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthMethod: SSHAuthMethod;
  sshPassword: string;
  sshKeyPath: string;
  sshKeyPassphrase: string;
  savePassword: boolean;
  saveSshPassword: boolean;
  saveSshKeyPassphrase: boolean;
  // AI privacy overrides (undefined = use global default)
  aiShareSchema?: boolean;
  aiShareData?: boolean;
}

export interface ConnectionTab {
  id: string;
  name: string;
  mode: ConnectionTabMode;
  currentStep: "method" | "details";
  formData: ConnectionFormData;
  connectionId: string | null;
  isConnecting: boolean;
  isTesting: boolean;
  error: string | null;
  credentialsLoaded: boolean;
}
