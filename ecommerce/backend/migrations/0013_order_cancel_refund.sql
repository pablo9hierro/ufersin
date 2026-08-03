-- Order cancellation + online Pix refund metadata.
-- `cancelado` is a terminal status (customer/admin cancel).
-- Tenant payment credentials are synced from Resolutoo platform so
-- ecommerce-api can create/refund Mercado Pago Pix without calling the
-- platform DB on every request.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pendente','montando_pedido','pedido_pronto','aguardando_localizacao',
    'em_rota_de_entrega','entregue','retiradas','entregas','concluido','cancelado'
  ));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pendente','pago','reembolsado'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_by TEXT
  CHECK (cancel_by IS NULL OR cancel_by IN ('cliente','admin'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canceled_at TEXT;
-- none | not_applicable | pending | refunded | refund_failed
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT
  CHECK (refund_status IS NULL OR refund_status IN (
    'none','not_applicable','pending','refunded','refund_failed'
  ));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT;
-- Which gateway created pix_payment_id (mercado_pago | abacate_pay | mock).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pix_provider TEXT
  CHECK (pix_provider IS NULL OR pix_provider IN ('mercado_pago','abacate_pay','mock'));

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forma_pagamento TEXT NOT NULL DEFAULT 'manual'
  CHECK (forma_pagamento IN ('manual','plataforma'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plataforma_pagamento TEXT
  CHECK (plataforma_pagamento IS NULL OR plataforma_pagamento IN ('mercado_pago','abacate_pay'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plataforma_credenciais JSONB;
