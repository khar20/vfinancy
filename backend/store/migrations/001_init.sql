CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE sequences (prefix TEXT PRIMARY KEY, last INTEGER NOT NULL DEFAULT 0);

CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE client_addresses (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), region TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, default_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_cost_cents >= 0), default_cost_currency TEXT NOT NULL DEFAULT 'PEN' CHECK(default_cost_currency IN ('PEN','USD')), default_cost_tc INTEGER NOT NULL DEFAULT 37500 CHECK(default_cost_tc BETWEEN 5000 AND 200000), default_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_price_cents >= 0), default_price_currency TEXT NOT NULL DEFAULT 'PEN' CHECK(default_price_currency IN ('PEN','USD')), default_price_tc INTEGER NOT NULL DEFAULT 37500 CHECK(default_price_tc BETWEEN 5000 AND 200000), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE product_suppliers (product_id INTEGER NOT NULL REFERENCES products(id), supplier_id INTEGER NOT NULL REFERENCES suppliers(id), PRIMARY KEY(product_id,supplier_id));
CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, last4 TEXT NOT NULL DEFAULT '', cut_day INTEGER NOT NULL CHECK(cut_day BETWEEN 1 AND 31), due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31), limit_cents INTEGER CHECK(limit_cents IS NULL OR limit_cents >= 0), limit_currency TEXT NOT NULL DEFAULT 'PEN' CHECK(limit_currency IN ('PEN','USD')), limit_tc INTEGER NOT NULL DEFAULT 37500 CHECK(limit_tc BETWEEN 5000 AND 200000), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);

CREATE TABLE purchases (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), date TEXT NOT NULL, payment_method TEXT NOT NULL CHECK(payment_method IN ('card','cash','wallet')), card_id INTEGER REFERENCES cards(id), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')), tc INTEGER NOT NULL CHECK(tc BETWEEN 5000 AND 200000), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','received')), for_client_id INTEGER REFERENCES clients(id), received_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE purchase_items (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), product_id INTEGER NOT NULL REFERENCES products(id), description TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL CHECK(qty > 0), unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0));
CREATE TABLE purchase_extras (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), concept TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')));

CREATE TABLE lots (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, product_id INTEGER NOT NULL REFERENCES products(id), purchase_item_id INTEGER REFERENCES purchase_items(id), source TEXT NOT NULL CHECK(source IN ('purchase','manual')), supplier_id INTEGER REFERENCES suppliers(id), qty_initial INTEGER NOT NULL CHECK(qty_initial > 0), unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')), tc INTEGER NOT NULL CHECK(tc BETWEEN 5000 AND 200000), entry_date TEXT NOT NULL, countdown_days INTEGER CHECK(countdown_days IS NULL OR countdown_days >= 0), countdown_start TEXT NOT NULL, reserved_client_id INTEGER REFERENCES clients(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE sales (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('sale','shipment')), client_id INTEGER REFERENCES clients(id), date TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')), tc INTEGER NOT NULL CHECK(tc BETWEEN 5000 AND 200000), shipment_status TEXT CHECK(shipment_status IS NULL OR shipment_status IN ('prepared','sent','delivered')), security_code TEXT, ship_region TEXT, ship_address TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id), lot_id INTEGER NOT NULL REFERENCES lots(id), description TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL CHECK(qty > 0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0));
CREATE TABLE sale_extras (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), concept TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')));

CREATE TABLE payments (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('payment','advance')), client_id INTEGER REFERENCES clients(id), sale_id INTEGER REFERENCES sales(id), purchase_id INTEGER REFERENCES purchases(id), date TEXT NOT NULL, method TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')), tc INTEGER NOT NULL CHECK(tc BETWEEN 5000 AND 200000), advance_status TEXT CHECK(advance_status IS NULL OR advance_status IN ('active','applied','refunded')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE card_expenses (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), date TEXT NOT NULL, concept TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), currency TEXT NOT NULL CHECK(currency IN ('PEN','USD')), tc INTEGER NOT NULL CHECK(tc BETWEEN 5000 AND 200000), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE card_cycle_payments (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), cycle_end TEXT NOT NULL, paid_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(card_id,cycle_end));

CREATE VIEW lot_stock AS
SELECT l.*, l.qty_initial - COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.lot_id=l.id AND s.voided_at IS NULL),0) AS available
FROM lots l WHERE l.voided_at IS NULL;

CREATE VIEW kardex AS
WITH movements AS (
  SELECT l.product_id, l.entry_date AS date, l.id AS ref_id, 'in' AS direction, l.qty_initial AS qty, l.code AS code FROM lots l WHERE l.voided_at IS NULL
  UNION ALL
  SELECT si.product_id, s.date, si.id, 'out', -si.qty, s.code FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.voided_at IS NULL
)
SELECT product_id,date,ref_id,direction,qty,code,
 SUM(qty) OVER (PARTITION BY product_id ORDER BY date,CASE direction WHEN 'in' THEN 0 ELSE 1 END,ref_id ROWS UNBOUNDED PRECEDING) AS balance
FROM movements;

CREATE INDEX idx_purchases_date ON purchases(date);
CREATE INDEX idx_purchases_card ON purchases(card_id,date) WHERE voided_at IS NULL;
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_lots_product_date ON lots(product_id,entry_date,id) WHERE voided_at IS NULL;
CREATE INDEX idx_lots_purchase_item ON lots(purchase_item_id);
CREATE INDEX idx_sales_date_client ON sales(date,client_id) WHERE voided_at IS NULL;
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_lot ON sale_items(lot_id);
CREATE INDEX idx_payments_sale ON payments(sale_id) WHERE voided_at IS NULL;
CREATE INDEX idx_payments_client_purchase ON payments(client_id,purchase_id) WHERE voided_at IS NULL;
CREATE INDEX idx_card_expenses_cycle ON card_expenses(card_id,date) WHERE voided_at IS NULL;
