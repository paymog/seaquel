import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { FIXTURES } from "../shared/fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE = "seaquel_test";

export default async function seed() {
  const config = {
    host: process.env.MARIADB_HOST || "127.0.0.1",
    port: Number(process.env.MARIADB_PORT) || 3307, // 3307 because mysql runs on 3306
    user: process.env.MARIADB_USER || "root",
    password: process.env.MARIADB_PASSWORD || "",
    multipleStatements: true,
  };

  // Ensure target database exists, then connect to it.
  const admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DATABASE}\``);
  await admin.end();

  const connection = await mysql.createConnection({ ...config, database: DATABASE });

  // Schema + all_types (DDL and dialect-specific coverage insert).
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await connection.query(schema);

  // Bulk-load shared fixtures.
  for (const { table, columns, rows } of FIXTURES) {
    if (rows.length === 0) continue;
    // mysql2 supports the "bulk VALUES ?" form: pass an array of row-arrays.
    const values = rows.map((row) => columns.map((c) => row[c]));
    await connection.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ?`, [values]);
    console.log(`${table}: ${rows.length} rows`);
  }

  // Verify
  const [counts] = await connection.query(`
      SELECT 'categories' as tbl, COUNT(*) as cnt FROM categories
      UNION ALL SELECT 'products', COUNT(*) FROM products
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'orders', COUNT(*) FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
      UNION ALL SELECT 'all_types', COUNT(*) FROM all_types
    `);

  for (const { tbl, cnt } of counts) {
    console.log(`  ${tbl}: ${cnt}`);
  }

  await connection.end();
  console.log("MariaDB seeded successfully");
}
