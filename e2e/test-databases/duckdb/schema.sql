-- Seaquel E2E Test Database - DuckDB
-- Schema + all_types coverage. Shared core data is loaded by seed.mjs from
-- ../shared/*.json.

-- Drop tables if they exist
DROP TABLE IF EXISTS all_types;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS categories;

-- Drop sequences if they exist
DROP SEQUENCE IF EXISTS categories_id_seq;
DROP SEQUENCE IF EXISTS products_id_seq;
DROP SEQUENCE IF EXISTS users_id_seq;
DROP SEQUENCE IF EXISTS orders_id_seq;
DROP SEQUENCE IF EXISTS order_items_id_seq;

-- Create sequences
CREATE SEQUENCE categories_id_seq;
CREATE SEQUENCE products_id_seq;
CREATE SEQUENCE users_id_seq;
CREATE SEQUENCE orders_id_seq;
CREATE SEQUENCE order_items_id_seq;

-- Categories table
CREATE TABLE categories (
    id INTEGER DEFAULT nextval('categories_id_seq') PRIMARY KEY,
    name VARCHAR NOT NULL,
    description VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id INTEGER DEFAULT nextval('products_id_seq') PRIMARY KEY,
    name VARCHAR NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category_id INTEGER,
    stock_quantity INTEGER DEFAULT 0,
    description VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Users table
CREATE TABLE users (
    id INTEGER DEFAULT nextval('users_id_seq') PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR UNIQUE NOT NULL,
    role VARCHAR DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id INTEGER DEFAULT nextval('orders_id_seq') PRIMARY KEY,
    user_id INTEGER,
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR DEFAULT 'pending',
    shipping_address VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Order items table
CREATE TABLE order_items (
    id INTEGER DEFAULT nextval('order_items_id_seq') PRIMARY KEY,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- All types table (regression coverage for every DuckDB data type)
CREATE TABLE all_types (
    id INTEGER PRIMARY KEY,
    col_tinyint TINYINT,
    col_smallint SMALLINT,
    col_integer INTEGER,
    col_bigint BIGINT,
    col_hugeint HUGEINT,
    col_utinyint UTINYINT,
    col_usmallint USMALLINT,
    col_uinteger UINTEGER,
    col_ubigint UBIGINT,
    col_float FLOAT,
    col_double DOUBLE,
    col_decimal DECIMAL(10,2),
    col_boolean BOOLEAN,
    col_varchar VARCHAR,
    col_blob BLOB,
    col_date DATE,
    col_time TIME,
    col_timestamp TIMESTAMP,
    col_timestamp_tz TIMESTAMPTZ,
    col_interval INTERVAL,
    col_uuid UUID,
    col_json JSON,
    col_int_array INTEGER[],
    col_varchar_array VARCHAR[],
    col_map MAP(VARCHAR, INTEGER),
    col_struct STRUCT(name VARCHAR, age INTEGER)
);

INSERT INTO all_types VALUES (
    1,
    127, 32000, 2147483647, 9223372036854775807, 170141183460469231731687303715884105727,
    255, 65535, 4294967295, 18446744073709551615,
    3.14, 2.718281828, 99999.99,
    TRUE,
    'variable length string',
    '\xDEADBEEF'::BLOB,
    '2026-03-08', '12:30:00', '2026-03-08 12:30:00', '2026-03-08 12:30:00+00', INTERVAL '1 year 2 months 3 days',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    '{"key": "value", "number": 42}',
    [1, 2, 3], ['hello', 'world'],
    MAP {'key1': 1, 'key2': 2},
    {'name': 'test', 'age': 42}
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
