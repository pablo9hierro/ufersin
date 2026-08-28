-- Uma marca (ex: "Samsung") pode valer pra mais de um tipo de aparelho
-- (celular E tablet), mas service_catalog_categories.device_type só guarda
-- um. Antes disso o lojista tinha que cadastrar "Samsung" e "Samsung
-- Tablet" como duas marcas separadas -- confuso e duplicado. Tabela nova
-- guarda TODOS os tipos que a marca atende; `device_type` na tabela
-- original continua existindo como "tipo primário" (compat com quem ainda
-- lê só essa coluna), sempre igual ao primeiro tipo selecionado.
CREATE TABLE IF NOT EXISTS eletronicos.category_device_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category_id UUID NOT NULL REFERENCES eletronicos.service_catalog_categories(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  UNIQUE (category_id, device_type)
);
CREATE INDEX IF NOT EXISTS idx_elt_cat_device_types_tenant ON eletronicos.category_device_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_elt_cat_device_types_category ON eletronicos.category_device_types(category_id);

INSERT INTO eletronicos.category_device_types (tenant_id, category_id, device_type)
SELECT tenant_id, id, device_type FROM eletronicos.service_catalog_categories
ON CONFLICT (category_id, device_type) DO NOTHING;

ALTER TABLE eletronicos.category_device_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eletronicos.category_device_types
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
