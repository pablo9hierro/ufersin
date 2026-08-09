-- Entidade Serviço — separada de produto (sem estoque próprio). Custo vem
-- da composição de itens de estoque (mesma tabela `ingredients` do ERP
-- Formulação, reaproveitada — um insumo serve tanto pra compor produto
-- quanto serviço) + custos extras em texto livre, mas o preço final é
-- sempre definido manualmente pelo lojista (diferente de produto ERP,
-- onde o preço de custo é 100% calculado).

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);

CREATE TABLE IF NOT EXISTS service_ingredients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('g','kg','ml','l','un')),
  UNIQUE (service_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_service_ingredients_tenant ON service_ingredients(tenant_id);

CREATE TABLE IF NOT EXISTS service_extra_costs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_service_extra_costs_tenant ON service_extra_costs(tenant_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['services', 'service_ingredients', 'service_extra_costs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
