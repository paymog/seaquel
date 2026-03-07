import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "seed.sql");

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "seaquel_test",
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
  `);

for (const { tbl, cnt } of rows) {
  console.log(`${tbl}: ${cnt} rows`);
}

await connection.end();
console.log("\nMySQL database seeded successfully");
