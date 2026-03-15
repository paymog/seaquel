import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "seed.sql");

const client = new pg.Client({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE || "seaquel_test",
});

await client.connect();

const sql = readFileSync(sqlPath, "utf-8");
await client.query(sql);

// Verify
const { rows } = await client.query(`
    SELECT 'categories' as tbl, COUNT(*) as cnt FROM categories
    UNION ALL SELECT 'products', COUNT(*) FROM products
    UNION ALL SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'orders', COUNT(*) FROM orders
    UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    UNION ALL SELECT 'all_types', COUNT(*) FROM all_types
  `);

for (const { tbl, cnt } of rows) {
  console.log(`${tbl}: ${cnt} rows`);
}

await client.end();
console.log("\nPostgreSQL database seeded successfully");
