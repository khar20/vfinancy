-- vfinancy local-first schema (single business, single user).
-- Money: TEXT decimal (NUMERIC-equivalent) with 18,2 semantics. Timestamps: INTEGER ms (UTC).

CREATE TABLE local_profiles (
    id                  TEXT PRIMARY KEY,
    name                VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
    tax_id              VARCHAR(11)  NOT NULL DEFAULT '' CHECK (tax_id = '' OR (length(tax_id) = 11 AND (substr(tax_id,1,2) IN ('10','20')))),
    email               VARCHAR(200) NOT NULL DEFAULT '',
    fiscal_address      VARCHAR(300) NOT NULL DEFAULT '',
    commercial_name     VARCHAR(200) NOT NULL DEFAULT '',
    phone               VARCHAR(30)  NOT NULL DEFAULT '',
    website             VARCHAR(300) NOT NULL DEFAULT '',
    password_hash       TEXT,
    security_question   TEXT NOT NULL DEFAULT '',
    security_answer_hash TEXT,
    password_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until        TIMESTAMP,
    created_at          TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at          TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);

CREATE UNIQUE INDEX uq_local_profiles_singleton ON local_profiles ((1));

CREATE TABLE application_settings (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    key        VARCHAR(100) NOT NULL,
    value      TEXT         NOT NULL DEFAULT '{}',
    created_at TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT ck_settings_key_nonblank CHECK (length(trim(key)) > 0)
);

CREATE UNIQUE INDEX uq_settings_key ON application_settings (key);

CREATE TABLE exchange_rates (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    from_currency VARCHAR(3)  NOT NULL,
    to_currency   VARCHAR(3)  NOT NULL,
    rate_date     DATE        NOT NULL,
    rate          TEXT        NOT NULL CHECK (CAST(rate AS REAL) > 0),
    source        VARCHAR(50) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'sunat', 'other', 'apis.net.pe', 'open.er-api.com', 'fallback')),
    created_at    TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT ck_exchange_rates_different_currencies CHECK (from_currency <> to_currency)
);

CREATE UNIQUE INDEX uq_exchange_rates_pair_date ON exchange_rates (from_currency, to_currency, rate_date);

CREATE TABLE sync_cursors (
    table_name      VARCHAR(100) NOT NULL,
    last_updated_at TIMESTAMP    NOT NULL DEFAULT 0,

    PRIMARY KEY (table_name)
);

CREATE TABLE sync_conflicts (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    table_name        VARCHAR(100) NOT NULL,
    record_id         TEXT         NOT NULL,
    local_updated_at  TIMESTAMP,
    remote_updated_at TIMESTAMP,
    resolution        VARCHAR(20)  NOT NULL DEFAULT 'LOCAL_WON' CHECK (resolution IN ('LOCAL_WON', 'REMOTE_WON')),
    message           TEXT,
    created_at        TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);

CREATE INDEX idx_sync_conflicts_record ON sync_conflicts (table_name, record_id);

CREATE TABLE sync_tombstones (
    table_name VARCHAR(100) NOT NULL,
    record_id  TEXT         NOT NULL,
    updated_at TIMESTAMP    NOT NULL,

    PRIMARY KEY (table_name, record_id)
);

CREATE INDEX idx_sync_tombstones_time ON sync_tombstones (table_name, updated_at);

CREATE TABLE customers (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_type   VARCHAR(3),
    document_number VARCHAR(30),
    business_name   VARCHAR(200) NOT NULL,
    email           VARCHAR(200),
    phone           VARCHAR(30),
    address         TEXT,
    current_debt    TEXT         NOT NULL DEFAULT '0.00' CHECK (CAST(current_debt AS REAL) >= 0),
    status          VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),

    created_at      TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at      TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at      TIMESTAMP,

    CONSTRAINT ck_customers_business_name_nonblank CHECK (length(trim(business_name)) > 0),
    CONSTRAINT ck_customers_doc_pair
        CHECK ((document_type IS NULL AND document_number IS NULL)
            OR (document_type IS NOT NULL AND document_number IS NOT NULL)),
    CONSTRAINT ck_customers_doc_type CHECK (document_type IS NULL OR document_type IN ('DNI', 'RUC')),
    CONSTRAINT ck_customers_dni
        CHECK (document_type <> 'DNI' OR length(document_number) = 8
            AND document_number GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT ck_customers_ruc
        CHECK (document_type <> 'RUC' OR (length(document_number) = 11
            AND (substr(document_number, 1, 2) IN ('10', '20'))
            AND document_number GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')),
    CONSTRAINT ck_customers_status CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX uq_customers_document
    ON customers (document_type, document_number)
    WHERE deleted_at IS NULL AND document_number IS NOT NULL;

CREATE TABLE products (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sku         VARCHAR(50)  NOT NULL,
    description TEXT         NOT NULL,
    unit_code   VARCHAR(20)  NOT NULL DEFAULT 'Unidad',
    cost_usd    TEXT         NOT NULL DEFAULT '0.00' CHECK (CAST(cost_usd AS REAL) >= 0),
    sale_price  TEXT         NOT NULL DEFAULT '0.00' CHECK (CAST(sale_price AS REAL) >= 0),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at  TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at  TIMESTAMP,

    CONSTRAINT ck_products_description_nonblank CHECK (length(trim(description)) > 0)
);

CREATE UNIQUE INDEX uq_products_sku ON products (sku) WHERE deleted_at IS NULL;

CREATE TABLE credit_cards (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    issuer           VARCHAR(100) NOT NULL,
    last_four        VARCHAR(4)   NOT NULL CHECK (last_four GLOB '[0-9][0-9][0-9][0-9]'),
    credit_limit     TEXT         NOT NULL DEFAULT '0.00' CHECK (CAST(credit_limit AS REAL) >= 0),
    current_balance  TEXT         NOT NULL DEFAULT '0.00' CHECK (CAST(current_balance AS REAL) >= 0),
    cut_off_day      INTEGER      NOT NULL CHECK (cut_off_day BETWEEN 1 AND 31),
    payment_due_day  INTEGER      NOT NULL CHECK (payment_due_day BETWEEN 1 AND 31),
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at       TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at       TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at       TIMESTAMP,

    CONSTRAINT ck_credit_cards_issuer_nonblank CHECK (length(trim(issuer)) > 0)
);

CREATE INDEX idx_credit_cards_active ON credit_cards (is_active) WHERE deleted_at IS NULL;

CREATE TABLE suppliers (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name         VARCHAR(200) NOT NULL,
    contact_name VARCHAR(200) NOT NULL DEFAULT '',
    phone        VARCHAR(30)  NOT NULL DEFAULT '',
    email        VARCHAR(200) NOT NULL DEFAULT '',
    address      TEXT,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at   TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at   TIMESTAMP    NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at   TIMESTAMP,

    CONSTRAINT ck_suppliers_name_nonblank CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX uq_suppliers_name ON suppliers (name) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_active ON suppliers (is_active) WHERE deleted_at IS NULL;

CREATE TABLE purchase_orders (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    number         VARCHAR(30) NOT NULL,
    order_date     TIMESTAMP   NOT NULL,
    expected_date  TIMESTAMP,
    received_date  TIMESTAMP,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
    currency_code  VARCHAR(3)  NOT NULL DEFAULT 'USD',
    payment_method VARCHAR(20) NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card', 'cash', 'digital_wallet')),
    exchange_rate  TEXT        NOT NULL DEFAULT '1.000000' CHECK (CAST(exchange_rate AS REAL) > 0),
    notes          TEXT,
    customer_id    TEXT,
    supplier_id    TEXT,
    credit_card_id TEXT,
    arrival_date   TIMESTAMP,
    cost_usd       TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(cost_usd AS REAL) >= 0),
    sale_price_pen TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(sale_price_pen AS REAL) >= 0),
    real_cost_pen  TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(real_cost_pen AS REAL) >= 0),
    refund_amount  TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(refund_amount AS REAL) >= 0),
    faulty         BOOLEAN     NOT NULL DEFAULT FALSE,
    faulty_reason  TEXT,
    cancelled_at   TIMESTAMP,
    cancelled_reason TEXT,

    created_at     TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at     TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at     TIMESTAMP,

    CONSTRAINT fk_purchase_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_purchase_orders_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_purchase_orders_card
        FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_purchase_orders_dates CHECK (expected_date IS NULL OR expected_date >= order_date)
);

CREATE UNIQUE INDEX uq_purchase_orders_number ON purchase_orders (number) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_orders_status ON purchase_orders (status, order_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_orders_card ON purchase_orders (credit_card_id, order_date) WHERE deleted_at IS NULL;

CREATE TABLE purchase_order_items (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    purchase_order_id TEXT       NOT NULL,
    product_id        TEXT,
    line_number       INTEGER    NOT NULL DEFAULT 1 CHECK (line_number >= 1),
    description       TEXT       NOT NULL,
    unit_code         VARCHAR(20) NOT NULL DEFAULT 'Unidad',
    quantity_ordered  TEXT       NOT NULL CHECK (CAST(quantity_ordered AS REAL) > 0),
    quantity_received TEXT       NOT NULL DEFAULT '0.0000' CHECK (CAST(quantity_received AS REAL) >= 0),
    unit_cost_usd     TEXT       NOT NULL CHECK (CAST(unit_cost_usd AS REAL) >= 0),
    line_total_usd    TEXT       NOT NULL DEFAULT '0.00',
    sale_price_pen    TEXT       NOT NULL DEFAULT '0.00' CHECK (CAST(sale_price_pen AS REAL) >= 0),
    created_at        TIMESTAMP  NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_purchase_order_items_order
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_purchase_order_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_purchase_order_items_description_nonblank CHECK (length(trim(description)) > 0)
);

CREATE INDEX idx_purchase_order_items_order ON purchase_order_items (purchase_order_id);
CREATE INDEX idx_purchase_order_items_product ON purchase_order_items (product_id);

-- Costos extras de una orden de compra (informativos: no afectan cost_usd / real_cost_pen).
CREATE TABLE purchase_extra_costs (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    purchase_order_id TEXT    NOT NULL,
    concept           TEXT    NOT NULL,
    amount            TEXT    NOT NULL DEFAULT '0.00' CHECK (CAST(amount AS REAL) >= 0),
    currency_code     VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate     TEXT    NOT NULL DEFAULT '1.000000' CHECK (CAST(exchange_rate AS REAL) > 0),

    created_at        TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at        TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_purchase_extra_costs_order
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_purchase_extra_costs_concept_nonblank CHECK (length(trim(concept)) > 0)
);

CREATE INDEX idx_purchase_extra_costs_order ON purchase_extra_costs (purchase_order_id);

CREATE TABLE inventory_batches (
    id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id             TEXT       NOT NULL,
    purchase_order_item_id TEXT,
    arrival_date           TIMESTAMP  NOT NULL,
    quantity               TEXT       NOT NULL DEFAULT '0.0000' CHECK (CAST(quantity AS REAL) >= 0),
    original_quantity      TEXT       NOT NULL DEFAULT '0.0000' CHECK (CAST(original_quantity AS REAL) >= 0),
    unit_cost              TEXT       NOT NULL DEFAULT '0.00' CHECK (CAST(unit_cost AS REAL) >= 0),
    exchange_rate          TEXT       NOT NULL DEFAULT '1.000000' CHECK (CAST(exchange_rate AS REAL) > 0),
    status                 VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'depleted', 'voided')),
    is_clearance           BOOLEAN    NOT NULL DEFAULT FALSE,

    created_at             TIMESTAMP  NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at             TIMESTAMP  NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_inventory_batches_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_batches_poi
        FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX idx_inventory_batches_product ON inventory_batches (product_id, status);
CREATE INDEX idx_inventory_batches_clearance ON inventory_batches (is_clearance, status) WHERE is_clearance = TRUE AND status = 'active';

CREATE TABLE inventory_movements (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    batch_id       TEXT      NOT NULL,
    product_id     TEXT      NOT NULL,
    movement_date  TIMESTAMP NOT NULL,
    type           VARCHAR(20) NOT NULL
        CHECK (type IN ('purchase_receipt', 'sale', 'void_sale', 'void_purchase', 'adjustment_in', 'adjustment_out')),
    reference_type VARCHAR(30),
    reference_id   TEXT,
    quantity_delta TEXT      NOT NULL CHECK (CAST(quantity_delta AS REAL) <> 0),
    balance_after  TEXT      NOT NULL DEFAULT '0.0000',
    unit_cost      TEXT      NOT NULL DEFAULT '0.00',
    notes          TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_inventory_movements_batch
        FOREIGN KEY (batch_id) REFERENCES inventory_batches(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_movements_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_inventory_movements_batch ON inventory_movements (batch_id, movement_date);
CREATE INDEX idx_inventory_movements_product ON inventory_movements (product_id, movement_date);
CREATE INDEX idx_inventory_movements_reference ON inventory_movements (reference_type, reference_id);

CREATE TABLE sales (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_id      TEXT        NOT NULL,
    number           VARCHAR(30) NOT NULL,
    sale_date        TIMESTAMP   NOT NULL,
    due_date         TIMESTAMP,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
    sale_type        VARCHAR(20) NOT NULL DEFAULT 'stock' CHECK (sale_type IN ('stock', 'client_order')),
    total            TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(total AS REAL) >= 0),
    paid_amount      TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(paid_amount AS REAL) >= 0),
    cost_total       TEXT        NOT NULL DEFAULT '0.00' CHECK (CAST(cost_total AS REAL) >= 0),
    profit           TEXT        NOT NULL DEFAULT '0.00',
    notes            TEXT,
    cancelled_at     TIMESTAMP,
    cancelled_reason TEXT,

    created_at       TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at       TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at       TIMESTAMP,

    CONSTRAINT fk_sales_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_sales_dates CHECK (due_date IS NULL OR due_date >= sale_date)
);

CREATE UNIQUE INDEX uq_sales_number ON sales (number) WHERE deleted_at IS NULL;
CREATE INDEX idx_sales_customer ON sales (customer_id, sale_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_sales_status ON sales (status, sale_date) WHERE deleted_at IS NULL;

CREATE TABLE sale_items (
    id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sale_id            TEXT      NOT NULL,
    product_id         TEXT      NOT NULL,
    inventory_batch_id TEXT,
    line_number        INTEGER   NOT NULL DEFAULT 1 CHECK (line_number >= 1),
    quantity           TEXT      NOT NULL CHECK (CAST(quantity AS REAL) > 0),
    unit_price         TEXT      NOT NULL CHECK (CAST(unit_price AS REAL) >= 0),
    line_total         TEXT      NOT NULL DEFAULT '0.00',
    cost_snapshot      TEXT      NOT NULL DEFAULT '0.00',
    description        TEXT,
    created_at         TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_sale_items_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_sale_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sale_items_batch
        FOREIGN KEY (inventory_batch_id) REFERENCES inventory_batches(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX idx_sale_items_product ON sale_items (product_id);

CREATE TABLE customer_payments (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_id    TEXT        NOT NULL,
    number         VARCHAR(30) NOT NULL,
    payment_date   TIMESTAMP   NOT NULL,
    amount         TEXT        NOT NULL CHECK (CAST(amount AS REAL) > 0),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'transfer', 'other')),
    reference      VARCHAR(100),
    notes          TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),

    created_at     TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at     TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at     TIMESTAMP,

    CONSTRAINT fk_customer_payments_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_customer_payments_number ON customer_payments (number) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_payments_customer ON customer_payments (customer_id, payment_date) WHERE deleted_at IS NULL;

CREATE TABLE customer_payment_allocations (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_payment_id TEXT NOT NULL,
    sale_id             TEXT NOT NULL,
    allocated_amount    TEXT NOT NULL CHECK (CAST(allocated_amount AS REAL) > 0),
    created_at          TIMESTAMP NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),

    CONSTRAINT fk_customer_payment_alloc_payment
        FOREIGN KEY (customer_payment_id) REFERENCES customer_payments(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_customer_payment_alloc_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_customer_payment_alloc_payment ON customer_payment_allocations (customer_payment_id);
CREATE INDEX idx_customer_payment_alloc_sale ON customer_payment_allocations (sale_id);

CREATE TABLE shipments (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code        VARCHAR(4)  NOT NULL,
    sale_id     TEXT,
    customer_id TEXT,
    description TEXT,
    notes       TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'shipped', 'delivered')),

    created_at  TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    deleted_at  TIMESTAMP,

    CONSTRAINT fk_shipments_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_shipments_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_shipments_code ON shipments (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipments_customer ON shipments (customer_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipments_status ON shipments (status, created_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_application_settings_sync_delete AFTER DELETE ON application_settings BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('application_settings', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_exchange_rates_sync_delete AFTER DELETE ON exchange_rates BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('exchange_rates', OLD.id, OLD.created_at);
END;

CREATE TRIGGER trg_customers_sync_delete AFTER DELETE ON customers BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('customers', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_products_sync_delete AFTER DELETE ON products BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('products', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_credit_cards_sync_delete AFTER DELETE ON credit_cards BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('credit_cards', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_purchase_orders_sync_delete AFTER DELETE ON purchase_orders BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('purchase_orders', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_purchase_order_items_sync_delete AFTER DELETE ON purchase_order_items BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('purchase_order_items', OLD.id, OLD.created_at);
END;

CREATE TRIGGER trg_purchase_extra_costs_sync_delete AFTER DELETE ON purchase_extra_costs BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('purchase_extra_costs', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_inventory_batches_sync_delete AFTER DELETE ON inventory_batches BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('inventory_batches', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_inventory_movements_sync_delete AFTER DELETE ON inventory_movements BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('inventory_movements', OLD.id, OLD.created_at);
END;

CREATE TRIGGER trg_sales_sync_delete AFTER DELETE ON sales BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('sales', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_sale_items_sync_delete AFTER DELETE ON sale_items BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('sale_items', OLD.id, OLD.created_at);
END;

CREATE TRIGGER trg_customer_payments_sync_delete AFTER DELETE ON customer_payments BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('customer_payments', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_customer_payment_allocations_sync_delete AFTER DELETE ON customer_payment_allocations BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('customer_payment_allocations', OLD.id, OLD.created_at);
END;

CREATE TRIGGER trg_suppliers_sync_delete AFTER DELETE ON suppliers BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('suppliers', OLD.id, OLD.updated_at);
END;

CREATE TRIGGER trg_shipments_sync_delete AFTER DELETE ON shipments BEGIN
    INSERT INTO sync_tombstones (table_name, record_id, updated_at)
    VALUES ('shipments', OLD.id, OLD.updated_at);
END;
