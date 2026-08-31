-- Cozinha (funcionário com acesso só à tela de cozinha) ganha conta própria,
-- em vez de reaproveitar a credencial do admin -- login unificado em
-- /funcionarios/login precisa identificar a role sozinho (motoboy/vendedor/
-- cozinha), mesma estrutura/isolamento de `vendedores`/`motoboys`.

CREATE TABLE cozinha_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, email)
);

ALTER TABLE cozinha_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cozinha_users
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
