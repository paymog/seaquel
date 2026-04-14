import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { FIXTURES } from "../shared/fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE = "seaquel_test";

export default async function seed() {
  const connection = {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
  };

  // Postgres has no CREATE DATABASE IF NOT EXISTS and CREATE DATABASE can't
  // run inside a tx — connect to the default "postgres" db and swallow 42P04.
  const admin = new pg.Client({ ...connection, database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    console.log(`Created database ${DATABASE}`);
  } catch (err) {
    if (err.code !== "42P04") throw err;
  }
  await admin.end();

  const client = new pg.Client({ ...connection, database: DATABASE });
  await client.connect();

  // Schema + all_types (DDL and dialect-specific coverage insert).
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await client.query(schema);

  // Bulk-load shared fixtures.
  for (const { table, columns, rows } of FIXTURES) {
    if (rows.length === 0) continue;
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const params = [];
      const valueClauses = batch.map((row) => {
        const placeholders = columns.map((_, j) => `$${params.length + j + 1}`);
        for (const col of columns) params.push(row[col]);
        return `(${placeholders.join(", ")})`;
      });
      await client.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valueClauses.join(", ")}`,
        params,
      );
    }
    console.log(`${table}: ${rows.length} rows`);
  }

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
    console.log(`  ${tbl}: ${cnt}`);
  }

  await client.end();
  console.log("PostgreSQL seeded successfully");
}
