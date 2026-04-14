-- Seaquel E2E Test Database - MariaDB
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
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category_id INT,
    stock_quantity INT DEFAULT 0,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    shipping_address VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Order items table
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT,
    product_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- All types table (regression coverage for every MariaDB data type)
CREATE TABLE all_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    col_tinyint TINYINT,
    col_smallint SMALLINT,
    col_mediumint MEDIUMINT,
    col_int INT,
    col_bigint BIGINT,
    col_decimal DECIMAL(10,2),
    col_float FLOAT,
    col_double DOUBLE,
    col_bit BIT(8),
    col_tinyint_unsigned TINYINT UNSIGNED,
    col_int_unsigned INT UNSIGNED,
    col_bigint_unsigned BIGINT UNSIGNED,
    col_boolean BOOLEAN,
    col_char CHAR(10),
    col_varchar VARCHAR(255),
    col_tinytext TINYTEXT,
    col_text TEXT,
    col_mediumtext MEDIUMTEXT,
    col_longtext LONGTEXT,
    col_binary BINARY(16),
    col_varbinary VARBINARY(255),
    col_tinyblob TINYBLOB,
    col_blob BLOB,
    col_mediumblob MEDIUMBLOB,
    col_longblob LONGBLOB,
    col_date DATE,
    col_datetime DATETIME,
    col_timestamp TIMESTAMP NULL,
    col_time TIME,
    col_year YEAR,
    col_json JSON,
    col_enum ENUM('a','b','c'),
    col_set SET('x','y','z'),
    col_inet6 INET6 NULL,
    col_uuid UUID NULL
);

INSERT INTO all_types (
    col_tinyint, col_smallint, col_mediumint, col_int, col_bigint,
    col_decimal, col_float, col_double, col_bit,
    col_tinyint_unsigned, col_int_unsigned, col_bigint_unsigned,
    col_boolean,
    col_char, col_varchar, col_tinytext, col_text, col_mediumtext, col_longtext,
    col_binary, col_varbinary, col_tinyblob, col_blob, col_mediumblob, col_longblob,
    col_date, col_datetime, col_timestamp, col_time, col_year,
    col_json, col_enum, col_set,
    col_inet6, col_uuid
) VALUES (
    127, 32000, 8388607, 2147483647, 9223372036854775807,
    99999.99, 3.14, 2.718281828, b'10101010',
    255, 4294967295, 18446744073709551615,
    TRUE,
    'fixed     ', 'variable length string', 'tiny text', 'regular text', 'medium text content', 'long text content',
    0x00112233445566778899AABBCCDDEEFF, 0xDEADBEEF, 0xFF, 0xCAFEBABE, 0xFACEFEED, 0xBAADF00D,
    '2026-03-08', '2026-03-08 12:30:00', '2026-03-08 12:30:00', '12:30:00', 2026,
    '{"key": "value", "number": 42}', 'b', 'x,y',
    '2001:db8::1', UUID()
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
