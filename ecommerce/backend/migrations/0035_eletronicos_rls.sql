-- Achado no audit de segurança (Paulo Ferro, Esquema 5): as tabelas do
-- schema `eletronicos` não tinham RLS ligado. Na prática isso NÃO era um
-- vazamento -- o backend só conecta com um role que É o dono das tabelas
-- (bypassa RLS de qualquer jeito, mesmo com ela ligada) e filtra tenant_id
-- manualmente em toda query (auditado: 15/15 DELETEs, todos os handlers
-- Path(id) do módulo). Ainda assim, defesa em profundidade pedida
-- explicitamente: mesmo padrão já usado pro schema `public` desde a
-- migration 0005_tenancy.sql (tenant_isolation, current_setting('app.
-- tenant_id', true)), agora replicado aqui.
--
-- NÃO FORCEd de propósito, mesma razão documentada em 0005_tenancy.sql: o
-- backend conecta como dono da tabela, então RLS sem FORCE fica dormente
-- pra ele (zero risco de quebrar nada agora) e vira a proteção de verdade
-- se um dia um role sem posse (ex: anon/authenticated de um acesso direto
-- futuro) tentar ler essas tabelas. Forçar exigiria confirmar que TODO
-- caminho de código sempre abre `tenant_tx` antes de qualquer query nessas
-- tabelas -- não verificado exaustivamente, fica pra depois se for preciso.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agenda_blocks','agenda_business_hours','agenda_settings','ai_model_configs','appointment_events',
    'appointments','assistant_config','assistant_conversations','assistant_messages','assistant_rag_documents',
    'catalog_models','consultation_otps','device_types','driver_location','error_log',
    'neighborhood_shipping_rates','pdv_payments','pdv_sale_items','pdv_sales','product_brands',
    'product_categories','product_devices','product_models','products','service_catalog_categories',
    'service_catalog_item_extra_costs','service_catalog_item_parts','service_catalog_items','service_diagnostics',
    'service_item_brands','service_item_devices','service_item_models','service_request_credentials',
    'stock_activity_log','whatsapp_state','whatsapp_templates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE eletronicos.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON eletronicos.%I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
