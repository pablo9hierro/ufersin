-- Comanda de PDV: cliente consumindo no local, paga o total no final.
-- Fechar a comanda vira exatamente uma venda de balcão normal (orders/
-- order_items, mesmo fluxo de create_sale) -- comanda_items é só o rascunho
-- que vai acumulando até o "pagar conta".
CREATE TABLE IF NOT EXISTS comandas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  opened_by_role TEXT NOT NULL,
  opened_by_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comandas_tenant ON comandas(tenant_id, status);

CREATE TABLE IF NOT EXISTS comanda_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comanda_id TEXT NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  quantity BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comanda_items_comanda ON comanda_items(comanda_id);

ALTER TABLE comandas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comandas
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE comanda_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comanda_items
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
