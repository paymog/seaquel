import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sql from "mssql";
import { FIXTURES } from "../shared/fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE = "seaquel_test";

export default async function seed() {
  const config = {
    server: process.env.MSSQL_HOST || "127.0.0.1",
    port: Number(process.env.MSSQL_PORT) || 1433,
    user: process.env.MSSQL_USER || "sa",
    password: process.env.MSSQL_PASSWORD || "Seaquel_Test_123!",
    options: { encrypt: false, trustServerCertificate: true },
  };

  // Ensure target database exists (run against master), then reconnect to it.
  const admin = await new sql.ConnectionPool({ ...config, database: "master" }).connect();
  await admin
    .request()
    .query(
      `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${DATABASE}') CREATE DATABASE [${DATABASE}]`,
    );
  await admin.close();

  const pool = await new sql.ConnectionPool({ ...config, database: DATABASE }).connect();

  // Schema + all_types. SQL Server uses GO batches; split if any are present.
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  const batches = schema.split(/^\s*GO\s*$/gim).filter((b) => b.trim());
  for (const batch of batches) {
    await pool.request().query(batch);
  }

  // Bulk-load shared fixtures.
  // mssql caps a single statement at 2100 parameters, so batch by column count.
  for (const { table, columns, rows } of FIXTURES) {
    if (rows.length === 0) continue;
    const maxRowsPerBatch = Math.max(1, Math.floor(2000 / columns.length));
    for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
      const batch = rows.slice(i, i + maxRowsPerBatch);
      const request = pool.request();
      const valueClauses = batch.map((row, r) => {
        const names = columns.map((col, c) => {
          const param = `p_${r}_${c}`;
          request.input(param, row[col]);
          return `@${param}`;
        });
        return `(${names.join(", ")})`;
      });
      await request.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valueClauses.join(", ")}`,
      );
    }
    console.log(`${table}: ${rows.length} rows`);
  }

  // Verify
  const result = await pool.request().query(`
      SELECT 'categories' as tbl, COUNT(*) as cnt FROM categories
      UNION ALL SELECT 'products', COUNT(*) FROM products
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'orders', COUNT(*) FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
      UNION ALL SELECT 'all_types', COUNT(*) FROM all_types
    `);

  for (const { tbl, cnt } of result.recordset) {
    console.log(`  ${tbl}: ${cnt}`);
  }

  await pool.close();
  console.log("SQL Server seeded successfully");
}
