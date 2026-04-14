-- Seaquel E2E Test Database - PostgreSQL
-- Schema + all_types coverage. Shared core data is loaded by seed.mjs from
-- ../shared/*.json.

-- Drop tables if they exist
DROP TABLE IF EXISTS all_types;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS categories;

-- Categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category_id INT,
    stock_quantity INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT,
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    shipping_address VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Order items table
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT,
    product_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- All types table (regression coverage for every PostgreSQL data type)
CREATE TABLE all_types (
    id SERIAL PRIMARY KEY,
    col_smallint SMALLINT,
    col_integer INTEGER,
    col_bigint BIGINT,
    col_decimal DECIMAL(10,2),
    col_numeric NUMERIC(12,4),
    col_real REAL,
    col_double DOUBLE PRECISION,
    col_smallserial SMALLSERIAL,
    col_serial SERIAL,
    col_bigserial BIGSERIAL,
    col_boolean BOOLEAN,
    col_char CHAR(10),
    col_varchar VARCHAR(255),
    col_text TEXT,
    col_bytea BYTEA,
    col_date DATE,
    col_time TIME,
    col_time_tz TIME WITH TIME ZONE,
    col_timestamp TIMESTAMP,
    col_timestamp_tz TIMESTAMP WITH TIME ZONE,
    col_interval INTERVAL,
    col_uuid UUID,
    col_json JSON,
    col_jsonb JSONB,
    col_xml XML,
    col_inet INET,
    col_cidr CIDR,
    col_macaddr MACADDR,
    col_bit BIT(8),
    col_bit_varying BIT VARYING(8),
    col_point POINT,
    col_line LINE,
    col_lseg LSEG,
    col_box BOX,
    col_path PATH,
    col_polygon POLYGON,
    col_circle CIRCLE,
    col_money MONEY,
    col_int_array INTEGER[],
    col_text_array TEXT[],
    col_tsquery TSQUERY,
    col_tsvector TSVECTOR
);

INSERT INTO all_types (
    col_smallint, col_integer, col_bigint,
    col_decimal, col_numeric, col_real, col_double,
    col_boolean,
    col_char, col_varchar, col_text,
    col_bytea,
    col_date, col_time, col_time_tz, col_timestamp, col_timestamp_tz, col_interval,
    col_uuid, col_json, col_jsonb, col_xml,
    col_inet, col_cidr, col_macaddr,
    col_bit, col_bit_varying,
    col_point, col_line, col_lseg, col_box, col_path, col_polygon, col_circle,
    col_money,
    col_int_array, col_text_array,
    col_tsquery, col_tsvector
) VALUES (
    32000, 2147483647, 9223372036854775807,
    99999.99, 12345678.1234, 3.14, 2.718281828,
    TRUE,
    'fixed     ', 'variable length string', 'regular text content',
    E'\\xDEADBEEF',
    '2026-03-08', '12:30:00', '12:30:00+00', '2026-03-08 12:30:00', '2026-03-08 12:30:00+00', '1 year 2 months 3 days',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '{"key": "value", "number": 42}', '{"key": "value", "number": 42}', '<root><element>text</element></root>',
    '192.168.1.1', '192.168.1.0/24', '08:00:2b:01:02:03',
    B'10101010', B'1010',
    '(1,2)', '{1,-1,0}', '[(0,0),(1,1)]', '(1,1),(0,0)', '[(0,0),(1,1),(2,0)]', '((0,0),(1,1),(1,0))', '<(0,0),5>',
    '$99,999.99',
    '{1,2,3}', '{"hello","world"}',
    'fat & cat', 'a fat cat sat on a mat'
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
