-- Módulo isolado "eletronicos" — ordem de serviço (checklist/garantia/
-- diagnóstico) e peças de estoque com garantia. Dentro da MESMA infra do
-- Resolutoo (mesmo Postgres do ecommerce-api), mas em schema próprio,
-- separado do schema público (produtos/serviços/pedidos compartilhados) —
-- só tenants com vertical='eletronicos' usam essas tabelas. Toda linha
-- carrega tenant_id (mesmo isolamento por RLS já usado no resto do banco);
-- nenhuma FK cruza pro schema público — referência por ID solto (mesmo
-- padrão já usado pelo schema assistant_ia do a-vrtek-gente).

CREATE SCHEMA IF NOT EXISTS eletronicos;

CREATE TABLE IF NOT EXISTS eletronicos.service_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  phone_model TEXT NOT NULL,
  problem_description TEXT NOT NULL,
  image_url TEXT,
  address_cep TEXT,
  address_street TEXT,
  address_number TEXT,
  address_reference TEXT,
  address_neighborhood TEXT,
  address_city TEXT,
  address_state TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending','accepted','rejected','retirada_local','em_busca',
      'in_progress','em_entrega','completed','em_pagamento',
      'delivered','finished','cancelled'
    )),
  quote_value NUMERIC,
  owner_notes TEXT,
  discount_percent INTEGER
    CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  self_pickup BOOLEAN NOT NULL DEFAULT false,
  shipping_price NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_elt_sr_tenant ON eletronicos.service_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_elt_sr_status ON eletronicos.service_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_elt_sr_created_at ON eletronicos.service_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS eletronicos.service_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id UUID NOT NULL UNIQUE
    REFERENCES eletronicos.service_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_services TEXT,
  warranty TEXT,
  final_value NUMERIC,
  pdf_url TEXT,
  closed_at TIMESTAMPTZ,
  used_parts JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_elt_so_tenant ON eletronicos.service_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_elt_so_request_id ON eletronicos.service_orders(request_id);

CREATE TABLE IF NOT EXISTS eletronicos.service_order_updates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_order_id UUID NOT NULL
    REFERENCES eletronicos.service_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  message TEXT,
  media_urls TEXT[] NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL DEFAULT 'update'
    CHECK (action_type IN ('created','checklist_update','update','completed','reopened')),
  component TEXT
);
CREATE INDEX IF NOT EXISTS idx_elt_sou_tenant ON eletronicos.service_order_updates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_elt_sou_order_id ON eletronicos.service_order_updates(service_order_id);
CREATE INDEX IF NOT EXISTS idx_elt_sou_created_at ON eletronicos.service_order_updates(created_at);

-- Peças de estoque COM GARANTIA (warranty_days) — diferente do `ingredients`
-- genérico do ERP Formulação (que não tem esse conceito); mantido isolado
-- de propósito, é vocabulário exclusivo de assistência técnica.
CREATE TABLE IF NOT EXISTS eletronicos.stock_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unidade' CHECK (unit IN ('unidade','caixa')),
  quantity NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC,
  warranty_days INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_elt_si_tenant ON eletronicos.stock_items(tenant_id);

CREATE TABLE IF NOT EXISTS eletronicos.stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  item_id UUID NOT NULL REFERENCES eletronicos.stock_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('entrada','saida')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('unidade','caixa')),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_elt_sm_tenant ON eletronicos.stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_elt_sm_item_id ON eletronicos.stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_elt_sm_moved_at ON eletronicos.stock_movements(moved_at DESC);

CREATE OR REPLACE FUNCTION eletronicos.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.type = 'entrada' THEN
    UPDATE eletronicos.stock_items SET quantity = quantity + NEW.quantity, updated_at = NOW() WHERE id = NEW.item_id;
  ELSE
    UPDATE eletronicos.stock_items SET quantity = quantity - NEW.quantity, updated_at = NOW() WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elt_apply_stock_movement ON eletronicos.stock_movements;
CREATE TRIGGER trg_elt_apply_stock_movement
  AFTER INSERT ON eletronicos.stock_movements
  FOR EACH ROW EXECUTE FUNCTION eletronicos.apply_stock_movement();

-- Isolamento por tenant (RLS) — mesmo padrão já usado no resto do banco
-- (ver migrations/0005_tenancy.sql).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_requests', 'service_orders', 'service_order_updates',
    'stock_items', 'stock_movements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE eletronicos.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON eletronicos.%I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
