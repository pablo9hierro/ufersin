-- ERP Formulação / Ficha Técnica (BOM) — produtos cujo estoque e custo são
-- calculados a partir dos insumos consumidos, nunca editáveis diretamente.
-- `products` continua sendo a fonte única (nunca duplicar em tabela
-- separada) — só ganha um marcador de origem; leitura de catálogo/vitrine/
-- PDV não muda em nada, só quem ESCREVE quantity/cost_price ganha guarda.

ALTER TABLE products ADD COLUMN IF NOT EXISTS origin_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_origin_type_check;
ALTER TABLE products ADD CONSTRAINT products_origin_type_check
  CHECK (origin_type IN ('manual', 'erp_formulation'));

CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'un')),
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients(tenant_id);

-- ON DELETE RESTRICT no ingredient_id: impede apagar um insumo ainda usado
-- numa formulação (deixaria o produto ERP dependente órfão/quebrado).
CREATE TABLE IF NOT EXISTS product_formulations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'un')),
  UNIQUE (product_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_formulations_tenant ON product_formulations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formulations_ingredient ON product_formulations(tenant_id, ingredient_id);

-- Ledger único de movimentação de estoque — reaproveitado por insumo E
-- produto manual (entrada manual do lojista) e pelas movimentações
-- automáticas de venda (consumo de insumo / restauro em cancelamento).
-- Não existia NENHUM sistema de auditoria de estoque no projeto antes disso.
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'ingredient')),
  entity_id TEXT NOT NULL,
  delta DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_entity ON stock_movements(tenant_id, entity_type, entity_id);

-- Mesmo padrão de RLS de 0005_tenancy.sql.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ingredients', 'product_formulations', 'stock_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
