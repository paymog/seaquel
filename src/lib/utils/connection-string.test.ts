import { describe, expect, it } from "vitest";
import type { ConnectionFormData } from "$lib/types";
import {
  buildConnectionString,
  getConnectionData,
  swapDatabaseInConnectionString,
  rewriteConnectionStringForTunnel,
} from "./connection-string";

function form(overrides: Partial<ConnectionFormData> = {}): ConnectionFormData {
  return {
    name: "PostgreSQL Connection",
    type: "postgres",
    host: "gn-db.rds.amazonaws.com",
    port: 5432,
    databaseName: "postgres",
    username: "admin",
    password: "secret",
    sslMode: "disable",
    connectionString: "",
    sshEnabled: false,
    sshHost: "",
    sshPort: 22,
    sshUsername: "",
    sshAuthMethod: "password",
    sshPassword: "",
    sshKeyPath: "",
    sshKeyPassphrase: "",
    savePassword: false,
    saveSshPassword: false,
    saveSshKeyPassphrase: false,
    ...overrides,
  };
}

describe("getConnectionData", () => {
  it("builds the connection string from structured fields, including the database", () => {
    const { connectionString } = getConnectionData(form());
    expect(connectionString).toBe(
      "postgres://admin:secret@gn-db.rds.amazonaws.com/postgres?sslmode=disable",
    );
  });

  it("prefers edited fields over a stale db-less pasted connection string", () => {
    // A db-less string pasted in the method step must not survive once the user
    // fills in the database in the details step — otherwise Postgres falls back
    // to using the username as the database name ("database admin does not exist").
    const { connectionString } = getConnectionData(
      form({ connectionString: "postgres://admin@gn-db.rds.amazonaws.com:5432" }),
    );
    expect(connectionString).toContain("/postgres");
    expect(connectionString).toBe(buildConnectionString(form()));
  });

  it("falls back to the raw connection string when no structured fields exist", () => {
    const { connectionString } = getConnectionData(
      form({
        host: "",
        databaseName: "",
        connectionString: "postgresql://u:p@h:5432/mydb",
      }),
    );
    expect(connectionString).toBe("postgres://u:p@h:5432/mydb");
  });

  it("uses the databaseName path for file-based sqlite connections", () => {
    const { connectionString } = getConnectionData(
      form({ type: "sqlite", host: "", databaseName: "/tmp/app.db" }),
    );
    expect(connectionString).toBe("sqlite:///tmp/app.db");
  });
});

describe("swapDatabaseInConnectionString", () => {
  it("swaps the database in the URL path, preserving credentials/host/params", () => {
    const swapped = swapDatabaseInConnectionString(
      "postgres://admin:secret@gn-db.rds.amazonaws.com:5432/app?sslmode=require",
      "analytics",
      "postgres",
    );
    expect(swapped).toBe(
      "postgres://admin:secret@gn-db.rds.amazonaws.com:5432/analytics?sslmode=require",
    );
  });

  it("normalizes a postgresql:// scheme and keeps it parseable", () => {
    const swapped = swapDatabaseInConnectionString(
      "postgresql://admin@host/dev",
      "prod",
      "postgres",
    );
    expect(swapped).toBe("postgres://admin@host/prod");
  });

  it("returns file-based (sqlite/duckdb) strings unchanged", () => {
    const conn = "sqlite:///tmp/app.db";
    expect(swapDatabaseInConnectionString(conn, "other", "sqlite")).toBe(conn);
  });

  it("returns undefined for undefined input", () => {
    expect(swapDatabaseInConnectionString(undefined, "x", "postgres")).toBeUndefined();
  });
});

describe("rewriteConnectionStringForTunnel", () => {
  it("rewrites host/port to the local tunnel forward, keeping path and params", () => {
    const rewritten = rewriteConnectionStringForTunnel(
      "postgres://admin:secret@gn-db.rds.amazonaws.com:5432/app?sslmode=require",
      49152,
    );
    expect(rewritten).toBe("postgres://admin:secret@127.0.0.1:49152/app?sslmode=require");
  });

  it("returns undefined for undefined input", () => {
    expect(rewriteConnectionStringForTunnel(undefined, 49152)).toBeUndefined();
  });
});
