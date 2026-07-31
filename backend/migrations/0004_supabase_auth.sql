-- Rodoletas passa a usar o Auth nativo do Supabase pro login/cadastro do
-- lojista (e-mail+senha com confirmação de e-mail de verdade, e-mail de
-- recuperação de senha de verdade, OAuth opcional) em vez do JWT/bcrypt
-- caseiro daqui. Ver ARQUITETURA.md §6 pro desenho completo.
--
-- Mudança central: `subscribers.id` deixa de ser gerado localmente e passa
-- a SER o `sub` (uuid) do usuário no projeto Supabase — assim o resto do
-- código (me.rs/onboarding.rs/assinatura.rs) continua usando
-- `claims.sub` como chave primária sem nenhuma mudança de query.
ALTER TABLE subscribers ALTER COLUMN id DROP DEFAULT;

-- Cadastro e escolha de plano viram dois passos separados: a conta pode
-- existir sem plano nenhum atrelado (POST /api/auth/bootstrap), só ganha
-- plano/valor/gateway em POST /api/assinaturas (agora exige login).
ALTER TABLE subscribers ALTER COLUMN plan_code DROP NOT NULL;
ALTER TABLE subscribers ALTER COLUMN plan_code DROP DEFAULT;
ALTER TABLE subscribers ALTER COLUMN valor_mensal DROP NOT NULL;
ALTER TABLE subscribers ALTER COLUMN gateway DROP NOT NULL;
ALTER TABLE subscribers ALTER COLUMN gateway DROP DEFAULT;

ALTER TABLE subscribers ALTER COLUMN status DROP DEFAULT;
ALTER TABLE subscribers ALTER COLUMN status SET DEFAULT 'sem_assinatura';
-- status agora: sem_assinatura | pendente | ativo | pausado | cancelado

-- Confirmação de e-mail e redefinição de senha passam a ser 100% do
-- Supabase (link real por e-mail, não código de 6 dígitos mockado) — essas
-- colunas nunca mais são lidas/escritas pelo backend Rust.
ALTER TABLE subscribers DROP COLUMN email_verified;
ALTER TABLE subscribers DROP COLUMN verification_code;
ALTER TABLE subscribers DROP COLUMN verification_expires_at;
ALTER TABLE subscribers DROP COLUMN reset_code;
ALTER TABLE subscribers DROP COLUMN reset_expires_at;

-- `password_hash` continua existindo — não pra autenticar o subscriber
-- (isso é 100% Supabase Auth e-mail+senha agora), só pra continuar
-- alimentando `admin_password_hash` no handoff de
-- POST /internal/provision-tenant (ver onboarding.rs). Populado a partir
-- da senha em texto puro que o frontend manda uma única vez em
-- POST /api/auth/bootstrap, logo depois do supabase.auth.signUp().
