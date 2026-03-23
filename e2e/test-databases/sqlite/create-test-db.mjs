import { readFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { faker } from "@faker-js/faker";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "test_sqlite.sqlite");
const sqlPath = join(__dirname, "seed.sql");

// Remove existing database and WAL/SHM files for a clean start
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    unlinkSync(dbPath + suffix);
  } catch {}
}

const db = new Database(dbPath);

// Enable WAL mode and foreign keys
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create schema from seed.sql
const sql = readFileSync(sqlPath, "utf-8");
db.exec(sql);

// Deterministic seed for reproducible data
faker.seed(42);

const BATCH_SIZE = 5000;

// --- Categories (small lookup table) ---
const categoryNames = [
  "Electronics",
  "Clothing",
  "Home & Garden",
  "Books",
  "Sports",
  "Toys",
  "Automotive",
  "Health",
  "Music",
  "Food & Drink",
];

const insertCategory = db.prepare("INSERT INTO categories (name, description) VALUES (?, ?)");
const insertCategories = db.transaction(() => {
  for (const name of categoryNames) {
    insertCategory.run(name, faker.commerce.department() + " - " + faker.lorem.sentence());
  }
});
insertCategories();
console.log(`categories: ${categoryNames.length} rows`);

// --- Products ---
const NUM_PRODUCTS = 1000;
const insertProduct = db.prepare(
  "INSERT INTO products (name, price, category_id, stock_quantity, description) VALUES (?, ?, ?, ?, ?)",
);
const insertProducts = db.transaction(() => {
  for (let i = 0; i < NUM_PRODUCTS; i++) {
    insertProduct.run(
      faker.commerce.productName(),
      parseFloat(faker.commerce.price({ min: 1, max: 2000 })),
      faker.number.int({ min: 1, max: categoryNames.length }),
      faker.number.int({ min: 0, max: 500 }),
      faker.commerce.productDescription(),
    );
  }
});
insertProducts();
console.log(`products: ${NUM_PRODUCTS} rows`);

// --- Users ---
const NUM_USERS = 50_000;
const roles = ["customer", "admin", "support", "manager"];
const insertUser = db.prepare(
  "INSERT INTO users (name, email, role, created_at) VALUES (?, ?, ?, ?)",
);
const insertUsersBatch = db.transaction((start, end) => {
  for (let i = start; i < end; i++) {
    insertUser.run(
      faker.person.fullName(),
      faker.internet.email({ provider: `user${i}.test` }),
      faker.helpers.arrayElement(roles),
      faker.date.between({ from: "2020-01-01", to: "2026-03-23" }).toISOString(),
    );
  }
});
for (let i = 0; i < NUM_USERS; i += BATCH_SIZE) {
  insertUsersBatch(i, Math.min(i + BATCH_SIZE, NUM_USERS));
}
console.log(`users: ${NUM_USERS} rows`);

// --- Orders (bulk of the 1M rows) ---
const NUM_ORDERS = 800_000;
const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"];
const insertOrder = db.prepare(
  "INSERT INTO orders (user_id, total, status, shipping_address, created_at) VALUES (?, ?, ?, ?, ?)",
);
const insertOrdersBatch = db.transaction((start, end) => {
  for (let i = start; i < end; i++) {
    insertOrder.run(
      faker.number.int({ min: 1, max: NUM_USERS }),
      parseFloat(faker.commerce.price({ min: 5, max: 5000 })),
      faker.helpers.arrayElement(statuses),
      faker.location.streetAddress({ useFullAddress: true }),
      faker.date.between({ from: "2020-01-01", to: "2026-03-23" }).toISOString(),
    );
  }
});
for (let i = 0; i < NUM_ORDERS; i += BATCH_SIZE) {
  insertOrdersBatch(i, Math.min(i + BATCH_SIZE, NUM_ORDERS));
  if ((i + BATCH_SIZE) % 100_000 === 0) {
    console.log(`  orders: ${Math.min(i + BATCH_SIZE, NUM_ORDERS)}/${NUM_ORDERS}...`);
  }
}
console.log(`orders: ${NUM_ORDERS} rows`);

// --- Order items ---
const NUM_ORDER_ITEMS = 150_000;
const insertOrderItem = db.prepare(
  "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
);
const insertOrderItemsBatch = db.transaction((start, end) => {
  for (let i = start; i < end; i++) {
    insertOrderItem.run(
      faker.number.int({ min: 1, max: NUM_ORDERS }),
      faker.number.int({ min: 1, max: NUM_PRODUCTS }),
      faker.number.int({ min: 1, max: 20 }),
      parseFloat(faker.commerce.price({ min: 1, max: 2000 })),
    );
  }
});
for (let i = 0; i < NUM_ORDER_ITEMS; i += BATCH_SIZE) {
  insertOrderItemsBatch(i, Math.min(i + BATCH_SIZE, NUM_ORDER_ITEMS));
}
console.log(`order_items: ${NUM_ORDER_ITEMS} rows`);

// --- All types (1 row for type coverage) ---
const insertAllTypes = db.prepare(`
  INSERT INTO all_types (
    col_integer, col_real, col_text, col_blob, col_numeric, col_boolean,
    col_date, col_datetime, col_timestamp, col_decimal,
    col_varchar, col_char, col_clob,
    col_float, col_double,
    col_smallint, col_mediumint, col_bigint, col_tinyint, col_int2, col_int8,
    col_unsigned_big_int, col_native_character, col_nchar, col_nvarchar
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertAllTypes.run(
  42,
  3.14,
  "hello world",
  Buffer.from("DEADBEEF", "hex"),
  123.456,
  1,
  "2026-03-08",
  "2026-03-08 12:30:00",
  "2026-03-08 12:30:00",
  99999.99,
  "variable length string",
  "fixed     ",
  "large text content",
  2.718,
  1.41421356,
  32000,
  8388607,
  922337203685477,
  127,
  255,
  1024,
  1844674407370955,
  "native character data",
  "nchar data",
  "nvarchar data",
);
console.log(`all_types: 1 row`);

// Verify total
const total = db
  .prepare(`
  SELECT SUM(cnt) as total FROM (
    SELECT COUNT(*) as cnt FROM categories
    UNION ALL SELECT COUNT(*) FROM products
    UNION ALL SELECT COUNT(*) FROM users
    UNION ALL SELECT COUNT(*) FROM orders
    UNION ALL SELECT COUNT(*) FROM order_items
    UNION ALL SELECT COUNT(*) FROM all_types
  )
`)
  .get();

console.log(`\nTotal rows: ${total.total}`);
db.close();
console.log(`Database created at ${dbPath}`);
