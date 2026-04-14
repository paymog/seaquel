/**
 * Shared test fixtures for all e2e databases.
 *
 * Each DB seeder runs its own schema.sql (DDL + all_types) and then loads
 * the same core data from these JSON files. Editing data? Change it here —
 * every DB picks it up.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(name) {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), "utf-8"));
}

// Insert order matters: parent tables first (referenced by FKs).
export const FIXTURES = [
  { table: "categories", columns: ["name", "description"], rows: load("categories") },
  {
    table: "products",
    columns: ["name", "price", "category_id", "stock_quantity", "description"],
    rows: load("products"),
  },
  {
    table: "users",
    columns: ["name", "email", "role", "created_at"],
    rows: load("users"),
  },
  {
    table: "orders",
    columns: ["user_id", "total", "status", "shipping_address", "created_at"],
    rows: load("orders"),
  },
  {
    table: "order_items",
    columns: ["order_id", "product_id", "quantity", "unit_price"],
    rows: load("order_items"),
  },
];
