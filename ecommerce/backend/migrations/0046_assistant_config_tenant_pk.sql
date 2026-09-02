-- assistant_config.id era PK sozinha ('default' singleton, herdado do
-- vrtech single-tenant). Isso quebraria um 2º tenant tentando inserir sua
-- própria linha 'default', porque colidiria com a PK já ocupada por outro
-- tenant. Vira composta (id, tenant_id) -- cada tenant tem seu próprio
-- singleton 'default'.
--
-- NOTA: em produção esse fix já tinha sido aplicado manualmente (fora do
-- fluxo de migração) antes de virar Assistente IA sair do beta pra todo
-- tenant. Idempotente de propósito -- seguro rodar tanto num banco que já
-- tem a PK composta quanto num banco novo/local que ainda não tem.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'eletronicos.assistant_config'::regclass
      AND i.indisprimary
      AND a.attname = 'tenant_id'
  ) THEN
    ALTER TABLE eletronicos.assistant_config DROP CONSTRAINT assistant_config_pkey;
    ALTER TABLE eletronicos.assistant_config ADD PRIMARY KEY (id, tenant_id);
  END IF;
END $$;
