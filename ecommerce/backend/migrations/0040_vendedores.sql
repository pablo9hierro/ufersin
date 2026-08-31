-- Vendedores (funcionário com acesso a PDV + relatório de vendas próprio)
-- nunca teve tabela de verdade -- só existia como RPC do Supabase apontando
-- pra uma tabela que não existe em produção (confirmado via
-- information_schema: zero colunas). Cadastro de vendedor sempre falhou
-- silenciosamente. Mesma estrutura/isolamento de `motoboys`.

CREATE TABLE vendedores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1,
  commission_active BIGINT NOT NULL DEFAULT 0,
  commission_percent DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, email)
);

ALTER TABLE vendedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendedores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
