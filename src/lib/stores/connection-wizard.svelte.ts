import type { DatabaseType, SSHAuthMethod } from "$lib/types";

export type WizardStep = "method" | "details";

export type WizardMode = "wizard" | "quick" | "reconnect" | "edit";

export interface WizardFormData {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: string;
  connectionString: string;
  // SSH Tunnel fields
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthMethod: SSHAuthMethod;
  sshPassword: string;
  sshKeyPath: string;
  sshKeyPassphrase: string;
  // Password storage flags (checked by default)
  savePassword: boolean;
  saveSshPassword: boolean;
  saveSshKeyPassphrase: boolean;
}

export interface DatabaseTypeConfig {
  value: DatabaseType;
  label: string;
  defaultPort: number;
  protocol: string[];
  description: string;
  icon: string;
}

export const databaseTypes: DatabaseTypeConfig[] = [
  {
    value: "postgres",
    label: "PostgreSQL",
    defaultPort: 5432,
    protocol: ["postgres", "postgresql"],
    description: "The world's most advanced open-source database",
    icon: "postgresql",
  },
  {
    value: "mysql",
    label: "MySQL",
    defaultPort: 3306,
    protocol: ["mysql"],
    description: "Popular open-source relational database",
    icon: "mysql",
  },
  {
    value: "mariadb",
    label: "MariaDB",
    defaultPort: 3306,
    protocol: ["mariadb"],
    description: "Community-developed fork of MySQL",
    icon: "mariadb",
  },
  {
    value: "sqlite",
    label: "SQLite",
    defaultPort: 0,
    protocol: ["sqlite"],
    description: "Lightweight file-based database",
    icon: "sqlite",
  },
  {
    value: "duckdb",
    label: "DuckDB",
    defaultPort: 0,
    protocol: ["duckdb"],
    description: "In-process analytical database",
    icon: "duckdb",
  },
  {
    value: "mssql",
    label: "SQL Server",
    defaultPort: 1433,
    protocol: ["mssql", "sqlserver"],
    description: "Microsoft's enterprise database",
    icon: "mssql",
  },
];
