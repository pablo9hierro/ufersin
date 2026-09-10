-- Catalogo de CFOP (Codigo Fiscal de Operacoes e Prestacoes) -- substitui
-- o uso solto de `tenant_fiscal_settings.cfop_padrao_saida` (TEXT livre,
-- sem catalogo, sem busca) por uma tabela pesquisavel + selecao do lojista
-- (`tenant_cfops`), com heranca real pro produto (products.cfop, ja
-- existente desde a migration 0050, continua sendo o override).
--
-- Seed inicial: subconjunto dos CFOPs de SAIDA mais comuns pra venda de
-- mercadoria/servico (grupos 5xxx=dentro do estado, 6xxx=interestadual),
-- documentados de forma identica e estavel ha decadas em toda referencia
-- fiscal brasileira (Convenio SINIEF s/n de 1970 e atualizacoes). NAO e a
-- tabela oficial completa (~600 codigos, incluindo os de ENTRADA que nao
-- se aplicam aqui) -- e extensivel: superadmin/suporte pode inserir mais
-- linhas em `fiscal_cfops` sem migration nova, sem reescrever nada deste
-- modulo. Nunca inventar um codigo alem destes sem confirmar na fonte
-- oficial (Portal Nacional da NF-e).
CREATE TABLE IF NOT EXISTS fiscal_cfops (
  codigo TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  contexto TEXT NOT NULL -- 'dentro_estado' | 'interestadual' | 'servico'
);

INSERT INTO fiscal_cfops (codigo, descricao, contexto) VALUES
  ('5101', 'Venda de produção do estabelecimento', 'dentro_estado'),
  ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 'dentro_estado'),
  ('5103', 'Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'dentro_estado'),
  ('5104', 'Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'dentro_estado'),
  ('5405', 'Venda de mercadoria adquirida/recebida de terceiros sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 'dentro_estado'),
  ('5910', 'Remessa em bonificação, doação ou brinde', 'dentro_estado'),
  ('5911', 'Remessa de amostra grátis', 'dentro_estado'),
  ('5933', 'Prestação de serviço tributado pelo ISSQN', 'servico'),
  ('5949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 'dentro_estado'),
  ('6101', 'Venda de produção do estabelecimento', 'interestadual'),
  ('6102', 'Venda de mercadoria adquirida ou recebida de terceiros', 'interestadual'),
  ('6108', 'Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte', 'interestadual'),
  ('6933', 'Prestação de serviço tributado pelo ISSQN', 'servico'),
  ('6949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 'interestadual')
ON CONFLICT (codigo) DO NOTHING;

-- CFOPs que o tenant efetivamente usa (pode ter varios, um marcado
-- padrao). Substitui `cfop_padrao_saida`, que fica só como cache/leitura
-- de compatibilidade por enquanto (nao removido nesta migration -- os 3
-- call-sites de fiscal.rs que ainda leem ela direto sao migrados no
-- codigo, nao aqui, pra nao quebrar emissao em producao no meio do deploy).
CREATE TABLE IF NOT EXISTS tenant_cfops (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cfop_codigo TEXT NOT NULL REFERENCES fiscal_cfops(codigo),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, cfop_codigo)
);
CREATE INDEX IF NOT EXISTS idx_tenant_cfops_tenant ON tenant_cfops (tenant_id);
-- No máximo um default por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_cfops_one_default
  ON tenant_cfops (tenant_id) WHERE is_default;

-- Backfill: quem já tinha `cfop_padrao_saida` preenchido (texto livre)
-- vira o CFOP padrão cadastrado, se o código bater com algum da tabela
-- oficial acima -- não perde a configuração já feita.
INSERT INTO tenant_cfops (id, tenant_id, cfop_codigo, is_default)
SELECT gen_random_uuid()::text, tfs.tenant_id, tfs.cfop_padrao_saida, true
FROM tenant_fiscal_settings tfs
WHERE tfs.cfop_padrao_saida IS NOT NULL
  AND EXISTS (SELECT 1 FROM fiscal_cfops fc WHERE fc.codigo = tfs.cfop_padrao_saida)
ON CONFLICT (tenant_id, cfop_codigo) DO NOTHING;
