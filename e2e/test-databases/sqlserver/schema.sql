-- Seaquel E2E Test Database - SQL Server
-- Schema + all_types coverage. Shared core data is loaded by seed.mjs from
-- ../shared/*.json.

-- Drop tables if they exist
IF OBJECT_ID('all_types', 'U') IS NOT NULL DROP TABLE all_types;
IF OBJECT_ID('order_items', 'U') IS NOT NULL DROP TABLE order_items;
IF OBJECT_ID('orders', 'U') IS NOT NULL DROP TABLE orders;
IF OBJECT_ID('products', 'U') IS NOT NULL DROP TABLE products;
IF OBJECT_ID('users', 'U') IS NOT NULL DROP TABLE users;
IF OBJECT_ID('categories', 'U') IS NOT NULL DROP TABLE categories;

-- Categories table
CREATE TABLE categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETDATE()
);

-- Products table
CREATE TABLE products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category_id INT,
    stock_quantity INT DEFAULT 0,
    description NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Users table
CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) UNIQUE NOT NULL,
    role NVARCHAR(50) DEFAULT 'customer',
    created_at DATETIME2 DEFAULT GETDATE()
);

-- Orders table
CREATE TABLE orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    total DECIMAL(10, 2) NOT NULL,
    status NVARCHAR(50) DEFAULT 'pending',
    shipping_address NVARCHAR(500),
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Order items table
CREATE TABLE order_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT,
    product_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    CONSTRAINT FK_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT FK_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

-- All types table (regression coverage for every SQL Server data type)
CREATE TABLE all_types (
    id INT IDENTITY(1,1) PRIMARY KEY,
    col_tinyint TINYINT,
    col_smallint SMALLINT,
    col_int INT,
    col_bigint BIGINT,
    col_decimal DECIMAL(10,2),
    col_numeric NUMERIC(12,4),
    col_float FLOAT,
    col_real REAL,
    col_money MONEY,
    col_smallmoney SMALLMONEY,
    col_bit BIT,
    col_char CHAR(10),
    col_varchar VARCHAR(255),
    col_nchar NCHAR(10),
    col_nvarchar NVARCHAR(255),
    col_text TEXT,
    col_ntext NTEXT,
    col_varchar_max VARCHAR(MAX),
    col_nvarchar_max NVARCHAR(MAX),
    col_binary BINARY(16),
    col_varbinary VARBINARY(255),
    col_varbinary_max VARBINARY(MAX),
    col_date DATE,
    col_time TIME,
    col_datetime DATETIME,
    col_datetime2 DATETIME2,
    col_datetimeoffset DATETIMEOFFSET,
    col_smalldatetime SMALLDATETIME,
    col_uniqueidentifier UNIQUEIDENTIFIER,
    col_xml XML,
    col_sql_variant SQL_VARIANT
);

INSERT INTO all_types (
    col_tinyint, col_smallint, col_int, col_bigint,
    col_decimal, col_numeric, col_float, col_real,
    col_money, col_smallmoney, col_bit,
    col_char, col_varchar, col_nchar, col_nvarchar,
    col_text, col_ntext, col_varchar_max, col_nvarchar_max,
    col_binary, col_varbinary, col_varbinary_max,
    col_date, col_time, col_datetime, col_datetime2, col_datetimeoffset, col_smalldatetime,
    col_uniqueidentifier, col_xml, col_sql_variant
) VALUES (
    255, 32000, 2147483647, 9223372036854775807,
    99999.99, 12345678.1234, 2.718281828, 3.14,
    99999.99, 214748.3647, 1,
    'fixed     ', 'variable length string', N'fixed     ', N'variable length string',
    'regular text', N'regular ntext', 'varchar max content', N'nvarchar max content',
    0x00112233445566778899AABBCCDDEEFF, 0xDEADBEEF, 0xCAFEBABE,
    '2026-03-08', '12:30:00', '2026-03-08 12:30:00', '2026-03-08 12:30:00.1234567', '2026-03-08 12:30:00.1234567 +00:00', '2026-03-08 12:30:00',
    'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', '<root><element>text</element></root>', 'variant value'
);

-- Create indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
