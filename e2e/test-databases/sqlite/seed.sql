-- Seaquel E2E Test Database - SQLite
-- This script creates the schema. Data is inserted by create-test-db.mjs using faker.

-- Drop tables if they exist
DROP TABLE IF EXISTS all_types;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS categories;

-- Categories table
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    stock_quantity INTEGER DEFAULT 0,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    total DECIMAL(10, 2) NOT NULL,
    status TEXT DEFAULT 'pending',
    shipping_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Order items table
CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL
);

-- All types table (for type coverage testing)
CREATE TABLE all_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    col_integer INTEGER,
    col_real REAL,
    col_text TEXT,
    col_blob BLOB,
    col_numeric NUMERIC,
    col_boolean BOOLEAN,
    col_date DATE,
    col_datetime DATETIME,
    col_timestamp TIMESTAMP,
    col_decimal DECIMAL(10,2),
    col_varchar VARCHAR(255),
    col_char CHAR(10),
    col_clob CLOB,
    col_float FLOAT,
    col_double DOUBLE,
    col_smallint SMALLINT,
    col_mediumint MEDIUMINT,
    col_bigint BIGINT,
    col_tinyint TINYINT,
    col_int2 INT2,
    col_int8 INT8,
    col_unsigned_big_int UNSIGNED BIG INT,
    col_native_character NATIVE CHARACTER(70),
    col_nchar NCHAR(55),
    col_nvarchar NVARCHAR(100)
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
