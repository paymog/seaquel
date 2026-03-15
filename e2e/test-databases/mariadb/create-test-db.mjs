import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "seed.sql");

const connection = await mysql.createConnection({
  host: process.env.MARIADB_HOST || "127.0.0.1",
  port: Number(process.env.MARIADB_PORT) || 3306,
  user: process.env.MARIADB_USER || "root",
  password: process.env.MARIADB_PASSWORD || "",
  database: process.env.MARIADB_DATABASE || "seaquel_test",
  multipleStatements: true,
});

const sql = readFileSync(sqlPath, "utf-8");
await connection.query(sql);

// Verify
const [rows] = await connection.query(`
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

await connection.end();
console.log("\nMariaDB database seeded successfully");
