-- Mesas de restaurante (Parte 3, usa_mesas): mesa numerada que abre/fecha uma
-- comanda. Nome `restaurant_tables` (não `tables`, genérico demais e fácil de
-- confundir em código/queries). Comanda avulsa (sem mesa) não usa nada disso --
-- continua livre, como sempre.
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre', 'ocupada')),
  comanda_id TEXT REFERENCES comandas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_tables_tenant_numero ON restaurant_tables(tenant_id, numero);

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurant_tables
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
