CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE motoboys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_customers_whatsapp ON customers(whatsapp);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price DOUBLE PRECISION NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 0,
  image_url TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_whatsapp TEXT NOT NULL,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('entrega','retirada')),
  neighborhood TEXT,
  address TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix','cartao','dinheiro')),
  payment_status TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente','pago')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
    'pendente','montando_pedido','pedido_pronto','aguardando_localizacao',
    'em_rota_de_entrega','entregue','retiradas','concluido'
  )),
  shipping_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  total DOUBLE PRECISION NOT NULL,
  motoboy_id TEXT REFERENCES motoboys(id),
  pix_payment_id TEXT,
  pix_qr_base64 TEXT,
  pix_copia_cola TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_whatsapp ON orders(customer_whatsapp);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  quantity BIGINT NOT NULL
);

CREATE TABLE neighborhood_shipping_rates (
  neighborhood TEXT PRIMARY KEY,
  price DOUBLE PRECISION NOT NULL DEFAULT 0
);
