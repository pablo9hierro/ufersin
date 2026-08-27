-- Achado real: as tabelas `device_types`/`catalog_models` (criadas nesta
-- sessao pro multi-select aparelho/marca/modelo de servicos/produtos)
-- nunca foram populadas com os dados que ja existiam soltos como texto
-- livre -- `service_catalog_categories.device_type` (celular/tablet/
-- notebook/computador) e `model_name` usado em service_catalog_items e
-- products.phone_model. Sem isso, "Aparelhos"/"Modelos" apareciam vazios
-- mesmo o tenant ja tendo esse dado de verdade cadastrado.

-- Aparelhos: um por device_type distinto ja usado em cada tenant.
INSERT INTO eletronicos.device_types (id, tenant_id, name, slug, icon_key, sort_order)
SELECT
  gen_random_uuid(),
  t.tenant_id,
  initcap(t.device_type),
  t.device_type,
  'generic',
  row_number() OVER (PARTITION BY t.tenant_id ORDER BY t.device_type) - 1
FROM (
  SELECT DISTINCT tenant_id, device_type
  FROM eletronicos.service_catalog_categories
  WHERE device_type IS NOT NULL AND device_type <> ''
) t
WHERE NOT EXISTS (
  SELECT 1 FROM eletronicos.device_types d
  WHERE d.tenant_id = t.tenant_id AND lower(d.name) = lower(t.device_type)
);

-- Modelos: um por (marca, model_name) distinto ja usado em
-- service_catalog_items, ligado a marca certa via category_id.
INSERT INTO eletronicos.catalog_models (id, tenant_id, brand_id, name, sort_order)
SELECT
  gen_random_uuid(),
  t.tenant_id,
  t.category_id,
  t.model_name,
  row_number() OVER (PARTITION BY t.tenant_id, t.category_id ORDER BY t.model_name) - 1
FROM (
  SELECT DISTINCT tenant_id, category_id, model_name
  FROM eletronicos.service_catalog_items
  WHERE model_name IS NOT NULL AND model_name <> ''
) t
WHERE NOT EXISTS (
  SELECT 1 FROM eletronicos.catalog_models m
  WHERE m.tenant_id = t.tenant_id AND m.brand_id = t.category_id AND lower(m.name) = lower(t.model_name)
);
