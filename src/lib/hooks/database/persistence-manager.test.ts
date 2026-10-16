import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "$lib/types";
import { PersistenceManager } from "./persistence-manager.svelte";
import { DatabaseState } from "./state.svelte";

const mocks = vi.hoisted(() => ({
  admin: true,
  serverSaveConnection: vi.fn(),
  keyring: {
    isAvailable: () => true,
    setDbPassword: vi.fn(),
    deleteDbPassword: vi.fn(),
    setSshPassword: vi.fn(),
    deleteSshPassword: vi.fn(),
    setSshKeyPassphrase: vi.fn(),
    deleteSshKeyPassphrase: vi.fn(),
  },
}));

vi.mock("$lib/utils/environment", () => ({ isServer: () => true }));
vi.mock("$lib/auth/token", () => ({ isAdmin: () => mocks.admin }));
vi.mock("$lib/services/keyring", () => ({ getKeyringService: () => mocks.keyring }));
vi.mock("$lib/services/server-connections", () => ({
  serverSaveConnection: mocks.serverSaveConnection,
  serverLoadConnections: vi.fn(),
  serverDeleteConnection: vi.fn(),
  AuthRequiredError: class extends Error {},
}));

const { keyring, serverSaveConnection } = mocks;

const connection = {
  id: "graph-node-primary",
  name: "Graph Node — primary",
  type: "postgres",
  host: "db.internal",
  port: 5432,
  databaseName: "graph",
  username: "graph",
  password: "",
  projectId: "project",
  labelIds: ["prod"],
  savePassword: true,
  saveSshPassword: true,
  saveSshKeyPassphrase: false,
} as unknown as DatabaseConnection;

describe("persistConnection in server mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin = true;
  });

  it("keeps the saved password when an admin persists a metadata-only change", async () => {
    await new PersistenceManager(new DatabaseState()).persistConnection(connection);

    expect(keyring.deleteDbPassword).not.toHaveBeenCalled();
    expect(keyring.deleteSshPassword).not.toHaveBeenCalled();
    expect(serverSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ savePassword: true, saveSshPassword: true, labelIds: ["prod"] }),
    );
  });

  it("lets explicit options turn password saving off", async () => {
    await new PersistenceManager(new DatabaseState()).persistConnection(connection, { savePassword: false });

    expect(keyring.deleteDbPassword).toHaveBeenCalledWith("graph-node-primary");
  });

  it("writes nothing for non-admins, whose writes the server rejects", async () => {
    mocks.admin = false;
    await new PersistenceManager(new DatabaseState()).persistConnection(connection);

    expect(serverSaveConnection).not.toHaveBeenCalled();
    expect(keyring.setDbPassword).not.toHaveBeenCalled();
    expect(keyring.deleteDbPassword).not.toHaveBeenCalled();
  });
});
