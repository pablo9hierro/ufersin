-- CFOPs alternativos habilitados por perfil fiscal (secao 5 do pedido de
-- reorganizacao fiscal): alem do CFOP padrao do perfil (coluna `cfop`,
-- migration 0056), o lojista pode habilitar outros CFOPs pra aquele
-- perfil especifico -- o override de CFOP no produto so pode escolher
-- entre esses (validado em fiscal.rs::update_product_fiscal), nunca um
-- codigo arbitrario. Continua sem tabela gigante de CFOP pesquisavel: e
-- so uma lista curta que o proprio lojista digita e mantem por perfil.
ALTER TABLE fiscal_profiles
  ADD COLUMN IF NOT EXISTS allowed_cfops TEXT[] NOT NULL DEFAULT '{}';
