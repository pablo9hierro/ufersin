-- Cadastro fiscal da empresa (Meu Plano -> Financeiro -> Fiscal), espelhado
-- pro Jubilados (empresa) e pro ecommerce-api (tenant_fiscal_settings) via
-- sync_fiscal_config. jubilados_empresa_id fica salvo aqui pra saber, numa
-- próxima edição, se é POST (criar) ou PUT (atualizar) no Jubilados.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS jubilados_empresa_id UUID,
  ADD COLUMN IF NOT EXISTS fiscal_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_razao_social TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_nome_fantasia TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_inscricao_estadual TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_logradouro TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_numero TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_complemento TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_bairro TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_municipio TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_uf TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_cep TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_regime_tributario TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_crt INTEGER,
  ADD COLUMN IF NOT EXISTS fiscal_ambiente TEXT CHECK (fiscal_ambiente IN ('homologacao', 'producao'));
