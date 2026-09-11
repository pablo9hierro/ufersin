-- Perfis fiscais: o lojista cria quantos quiser, com nome livre (ex.
-- "Venda interna PB", "Venda interestadual", "Servico"), cada um com seus
-- proprios CFOP/CST/CSOSN/cclass_trib. Isso substitui a ideia de "o produto
-- TEM um CFOP fixo" por "o produto HERDA de um perfil, que muda por venda"
-- -- ver src/fiscal/resolution.rs. Templates sugeridos na tela de criacao
-- (interna/interestadual/servico) sao so preenchimento inicial no
-- frontend, nao ha FK ou enum fixo aqui: o nome e livre de proposito.
CREATE TABLE IF NOT EXISTS fiscal_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cfop TEXT,
  cst TEXT,
  csosn TEXT,
  cclass_trib TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_profiles_tenant ON fiscal_profiles (tenant_id);
-- No maximo um perfil default por tenant (mesmo padrao de idx_tenant_cfops_one_default).
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_profiles_one_default
  ON fiscal_profiles (tenant_id) WHERE is_default;
