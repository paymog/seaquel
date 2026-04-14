import { readFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { FIXTURES } from "../shared/fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "seaquel_test.sqlite");

export default async function seed() {
  // Remove existing database and WAL/SHM files for a clean start
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {}
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Schema + all_types (DDL and dialect-specific coverage insert).
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  // Bulk-load shared fixtures. better-sqlite3 is synchronous; wrap each
  // table's inserts in a transaction for speed.
  for (const { table, columns, rows } of FIXTURES) {
    if (rows.length === 0) continue;
    const stmt = db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    const insertAll = db.transaction((items) => {
      for (const row of items) stmt.run(columns.map((c) => row[c]));
    });
    insertAll(rows);
    console.log(`${table}: ${rows.length} rows`);
  }

  // Verify
  const counts = db
    .prepare(`
      SELECT 'categories' as tbl, COUNT(*) as cnt FROM categories
      UNION ALL SELECT 'products', COUNT(*) FROM products
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'orders', COUNT(*) FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
      UNION ALL SELECT 'all_types', COUNT(*) FROM all_types
    `)
    .all();

  for (const { tbl, cnt } of counts) {
    console.log(`  ${tbl}: ${cnt}`);
  }

  db.close();
  console.log(`SQLite seeded successfully (${dbPath})`);
}
