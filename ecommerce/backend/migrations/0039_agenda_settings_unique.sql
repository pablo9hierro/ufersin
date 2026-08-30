-- `eletronicos.agenda_settings`/`agenda_business_hours`/`whatsapp_templates`
-- nunca tiveram uma constraint UNIQUE por tenant_id (foram provisionadas à
-- mão pro tenant eletrônica original, fora do fluxo de migração) -- isso
-- quebrou o seed idempotente do ramo ecommerce (`ON CONFLICT (tenant_id)`
-- falhava com "no unique or exclusion constraint matching", e sem a
-- constraint uma corrida real entre requisições concorrentes conseguia
-- inserir linha duplicada). Antes de adicionar cada constraint, remove
-- qualquer duplicata que corridas anteriores possam ter deixado (mantém a
-- linha mais antiga por ctid), senão o ADD CONSTRAINT falha e derruba o
-- boot inteiro (sqlx::migrate! só tolera erro de checksum, não este).

DELETE FROM eletronicos.agenda_settings a USING eletronicos.agenda_settings b
  WHERE a.tenant_id = b.tenant_id AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'eletronicos.agenda_settings'::regclass
      AND contype = 'u' AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'eletronicos.agenda_settings'::regclass AND attname = 'tenant_id'
      )]
  ) THEN
    ALTER TABLE eletronicos.agenda_settings ADD CONSTRAINT agenda_settings_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;

DELETE FROM eletronicos.agenda_business_hours a USING eletronicos.agenda_business_hours b
  WHERE a.tenant_id = b.tenant_id AND a.weekday = b.weekday AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'eletronicos.agenda_business_hours'::regclass
      AND contype = 'u'
  ) THEN
    ALTER TABLE eletronicos.agenda_business_hours ADD CONSTRAINT agenda_business_hours_tenant_weekday_key UNIQUE (tenant_id, weekday);
  END IF;
END $$;

DELETE FROM eletronicos.whatsapp_templates a USING eletronicos.whatsapp_templates b
  WHERE a.tenant_id = b.tenant_id AND a.template_key = b.template_key AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'eletronicos.whatsapp_templates'::regclass
      AND contype = 'u'
  ) THEN
    ALTER TABLE eletronicos.whatsapp_templates ADD CONSTRAINT whatsapp_templates_tenant_key_key UNIQUE (tenant_id, template_key);
  END IF;
END $$;
