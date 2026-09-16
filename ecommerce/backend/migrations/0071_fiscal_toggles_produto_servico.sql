-- Dois toggles reais e independentes em vez do flag automático único que
-- `sync_fiscal_config` ligava sozinho ao salvar o cadastro fiscal da
-- plataforma. Nada é apagado ao desligar -- desligar só esconde a área
-- correspondente no front e passa a bloquear novas gravações/emissões no
-- back (ver fiscal.rs); os dados que já existiam continuam intactos.
ALTER TABLE tenant_fiscal_settings
  ADD COLUMN IF NOT EXISTS emitir_produto BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emitir_servico BOOLEAN NOT NULL DEFAULT false;

-- Cadastro fiscal específico de serviço (NFS-e) -- só os 2 dados que não
-- existem no NF-e de produto (código de serviço municipal, alíquota ISS).
-- Regime/ambiente/CNPJ/certificado continuam vindo de tenant_fiscal_settings
-- (mesma empresa, não duplica). Mesmo padrão de PK/enabled de
-- tenant_fiscal_settings.
CREATE TABLE IF NOT EXISTS tenant_fiscal_servico_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  codigo_servico_municipal TEXT,
  aliquota_iss NUMERIC,
  regime_especial_tributacao TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
