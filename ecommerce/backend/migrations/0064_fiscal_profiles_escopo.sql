-- Substitui a heuristica de casamento por SUBSTRING no nome livre do perfil
-- (nome.contains("interestadual")/"cpf"/"cnpj" em resolution.rs) por uma
-- coluna estruturada. A heuristica por nome falhava silenciosamente sempre
-- que o lojista nomeava o perfil de outro jeito, caindo no perfil default
-- com CFOP/CST errado numa venda interestadual sem nenhum aviso.
ALTER TABLE fiscal_profiles
  ADD COLUMN IF NOT EXISTS escopo TEXT NOT NULL DEFAULT 'outro'
  CHECK (escopo IN ('padrao', 'cpf_fora_estado', 'cnpj_fora_estado_nao_contribuinte', 'cnpj_fora_estado_contribuinte', 'outro'));

-- No maximo um perfil por (tenant, escopo) pros escopos estruturados --
-- 'outro' fica de fora de proposito (varios perfis "genericos" continuam
-- permitidos, so nao participam da selecao automatica por escopo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_profiles_one_per_escopo
  ON fiscal_profiles (tenant_id, escopo) WHERE escopo != 'outro';

-- Backfill: perfil default vira 'padrao'. Pro resto, replica (so nesta
-- migration, nunca mais em runtime) a MESMA heuristica de substring que
-- estava em nome_bate_uf/select_automatic_profile antes desta migration,
-- pra tenants ja configurados nao ficarem todos em 'outro'.
UPDATE fiscal_profiles SET escopo = 'padrao' WHERE is_default;

UPDATE fiscal_profiles
  SET escopo = 'cnpj_fora_estado_nao_contribuinte'
  WHERE escopo = 'outro'
    AND lower(nome) LIKE '%interestadual%'
    AND lower(nome) LIKE '%cnpj%';

UPDATE fiscal_profiles
  SET escopo = 'cpf_fora_estado'
  WHERE escopo = 'outro'
    AND lower(nome) LIKE '%interestadual%'
    AND lower(nome) LIKE '%cpf%';
