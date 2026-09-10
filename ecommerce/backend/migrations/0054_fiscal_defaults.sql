-- Defaults fiscais por tenant pra CST/CSOSN, CEST e Classificação Tributária
-- (IBS/CBS) -- mesmo espírito de cfop_padrao_saida/tenant_cfops (migration
-- 0053): produto sem valor específico herda o padrão da empresa, cadastrado
-- uma vez em Meu Plano -> Integrações, editável por produto quando precisar
-- de exceção (resolução em `build_fiscal_items`, ecommerce/backend).
ALTER TABLE tenant_fiscal_settings
  ADD COLUMN IF NOT EXISTS cst_padrao TEXT,
  ADD COLUMN IF NOT EXISTS csosn_padrao TEXT,
  ADD COLUMN IF NOT EXISTS cest_padrao TEXT,
  ADD COLUMN IF NOT EXISTS cclass_trib_padrao TEXT;
