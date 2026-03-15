import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sql from "mssql";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "seed.sql");

const config = {
  server: process.env.MSSQL_HOST || "127.0.0.1",
  port: Number(process.env.MSSQL_PORT) || 1433,
  user: process.env.MSSQL_USER || "sa",
  password: process.env.MSSQL_PASSWORD || "",
  database: process.env.MSSQL_DATABASE || "seaquel_test",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);

const sqlContent = readFileSync(sqlPath, "utf-8");

// SQL Server needs statements executed separately when using GO batches
// Split by GO statements if present, otherwise execute as one
const batches = sqlContent.split(/^\s*GO\s*$/gim).filter((b) => b.trim());
for (const batch of batches) {
  await pool.request().query(batch);
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
  console.log(`${tbl}: ${cnt} rows`);
}

await pool.close();
console.log("\nSQL Server database seeded successfully");
