-- Funcionário (motoboy/vendedor/cozinha) loga com WhatsApp+senha, nunca
-- e-mail -- motoboys já tinha `phone`; vendedores e cozinha_users ganham a
-- coluna agora. `email` continua existindo nas 3 tabelas (histórico/futuro
-- uso), só deixa de ser pedido no cadastro e de valer pra login.
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE cozinha_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE vendedores ALTER COLUMN email DROP NOT NULL;
ALTER TABLE cozinha_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE motoboys ALTER COLUMN email DROP NOT NULL;

-- Login passa a ser por telefone -- precisa ser único por loja (senão a
-- query de login não sabe qual conta é qual).
CREATE UNIQUE INDEX IF NOT EXISTS motoboys_tenant_phone_key ON motoboys (tenant_id, phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS vendedores_tenant_phone_key ON vendedores (tenant_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cozinha_users_tenant_phone_key ON cozinha_users (tenant_id, phone) WHERE phone IS NOT NULL;
