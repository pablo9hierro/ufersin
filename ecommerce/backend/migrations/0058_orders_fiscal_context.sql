-- Contexto fiscal da venda -- o pedido passa a poder carregar o suficiente
-- pra resolver CFOP/CST/CSOSN sem nunca precisar editar o produto (venda
-- interestadual, cliente com CPF/CNPJ, etc.). Tudo opcional/nullable e com
-- default que preserva o comportamento atual: pedido sem nenhum desses
-- campos preenchidos continua funcionando exatamente como hoje (sem nota,
-- sem documento do cliente) -- ver PDV (pdv.rs) e checkout da vitrine
-- (resolutoo.create_order), que so passam a mandar isso se o lojista/
-- cliente optar por "Emitir nota fiscal? Sim".
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS emitir_nota_fiscal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS destinatario_documento_tipo TEXT CHECK (destinatario_documento_tipo IN ('cpf', 'cnpj')),
  ADD COLUMN IF NOT EXISTS destinatario_documento TEXT,
  ADD COLUMN IF NOT EXISTS destinatario_nome TEXT,
  ADD COLUMN IF NOT EXISTS destinatario_uf TEXT,
  ADD COLUMN IF NOT EXISTS destinatario_municipio_ibge TEXT,
  ADD COLUMN IF NOT EXISTS destinatario_cep TEXT,
  ADD COLUMN IF NOT EXISTS destinatario_endereco TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_profile_id TEXT REFERENCES fiscal_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fiscal_profile_mode TEXT NOT NULL DEFAULT 'automatico' CHECK (fiscal_profile_mode IN ('automatico', 'manual'));
