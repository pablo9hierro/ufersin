-- UF/municipio de ORIGEM da empresa (onde o estabelecimento fica),
-- necessarios pra resolution.rs decidir se uma venda e interna ou
-- interestadual (uf_origem == uf_destino do pedido). Hoje esse dado so
-- existe do lado da plataforma (ufersin/backend, subscribers.fiscal_uf/
-- fiscal_municipio) e nunca foi sincronizado pra ca -- sync_fiscal_config
-- (internal.rs) passa a mandar isso junto no mesmo payload que ja envia
-- jubilados_empresa_id/ambiente/cfop_padrao_saida.
ALTER TABLE tenant_fiscal_settings
  ADD COLUMN IF NOT EXISTS uf_origem TEXT,
  ADD COLUMN IF NOT EXISTS municipio_origem_ibge TEXT;
