import { describe, expect, it } from "vitest";
import { getAdapter } from "./index";

// Import through ./index (the app's normal entry) so the adapter modules load in
// the same order as production. Importing PostgresAdapter directly from
// ./postgres makes it the module-graph entry and trips the index.ts ⇄ adapter
// circular import (PostgresAdapter is undefined when index.ts instantiates it).
describe("PostgresAdapter.getDatabasesQuery", () => {
  const query = getAdapter("postgres").getDatabasesQuery!();

  it("selects the database name column", () => {
    expect(query).toContain("SELECT datname");
    expect(query).toContain("FROM pg_database");
  });

  it("excludes databases that refuse connections (e.g. template0)", () => {
    expect(query).toContain("datallowconn");
  });

  it("excludes template databases (e.g. template1)", () => {
    expect(query).toMatch(/NOT datistemplate/i);
  });

  it("orders results for a stable dropdown", () => {
    expect(query).toMatch(/ORDER BY datname/i);
  });
});
