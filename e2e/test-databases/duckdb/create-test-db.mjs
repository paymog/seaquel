import { readFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DuckDBInstance } from "@duckdb/node-api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "test_duckdb.duckdb");
const sqlPath = join(__dirname, "seed.sql");

// Remove existing database files for a clean start
for (const suffix of ["", ".wal"]) {
  try {
    unlinkSync(dbPath + suffix);
  } catch {}
}

const instance = await DuckDBInstance.create(dbPath);
const conn = await instance.connect();

const sql = readFileSync(sqlPath, "utf-8");
await conn.run(sql);

// Verify
const reader = await conn.runAndReadAll(`
    SELECT 'categories' as tbl, COUNT(*) as cnt FROM categories
    UNION ALL SELECT 'products', COUNT(*) FROM products
    UNION ALL SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'orders', COUNT(*) FROM orders
    UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    UNION ALL SELECT 'all_types', COUNT(*) FROM all_types
  `);

for (const row of reader.getRows()) {
  // oxlint-disable-next-line typescript-eslint(restrict-template-expressions)
  console.log(`${row[0]}: ${row[1]} rows`);
}

conn.closeSync();
console.log(`\nDatabase created at ${dbPath}`);
