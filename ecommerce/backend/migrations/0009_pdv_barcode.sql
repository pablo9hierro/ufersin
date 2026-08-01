-- PDV + barcode for Railway multi-tenant products/orders.
-- Mirrors sunset_vendedor_pdv.sql bits the motor was missing.

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_barcode
  ON products (tenant_id, barcode)
  WHERE barcode IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sold_by_role TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sold_by_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Balcão (PDV) — walk-in sale, no delivery/pickup flow.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_type_check
  CHECK (delivery_type IN ('entrega', 'retirada', 'balcao'));

-- PDV may omit a real customer (Cliente balcão without WhatsApp).
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
