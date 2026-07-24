-- Rodoletas: conta do assinante (login/dashboard) + onboarding + link pro
-- Tenant provisionado no motor de e-commerce. `subscribers` continua a
-- mesma tabela de sempre (a linha nasce em POST /api/assinaturas, como já
-- funcionava) — isso só acrescenta o que faltava pra virar conta de
-- verdade com senha e o rastro do onboarding.

ALTER TABLE subscribers ADD COLUMN password_hash text;
ALTER TABLE subscribers ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE subscribers ADD COLUMN verification_code text;
ALTER TABLE subscribers ADD COLUMN verification_expires_at timestamptz;
ALTER TABLE subscribers ADD COLUMN reset_code text;
ALTER TABLE subscribers ADD COLUMN reset_expires_at timestamptz;

-- Plano escolhido no checkout (essential|management|premium) — plano/preço
-- reais vivem no motor de e-commerce (migrations/0005_tenancy.sql de lá);
-- aqui é só o que foi escolhido nesta assinatura, pra saber o que
-- provisionar quando o pagamento for confirmado.
ALTER TABLE subscribers ADD COLUMN plan_code text NOT NULL DEFAULT 'essential';
ALTER TABLE subscribers ADD COLUMN gateway text NOT NULL DEFAULT 'mercadopago';

-- Onboarding (preenchido depois do pagamento confirmado, antes do
-- provisionamento automático do Tenant).
ALTER TABLE subscribers ADD COLUMN categoria text;
ALTER TABLE subscribers ADD COLUMN endereco text;
ALTER TABLE subscribers ADD COLUMN logo_url text;
ALTER TABLE subscribers ADD COLUMN cor_principal text;
ALTER TABLE subscribers ADD COLUMN banner_url text;
ALTER TABLE subscribers ADD COLUMN slug text UNIQUE;
ALTER TABLE subscribers ADD COLUMN onboarding_status text NOT NULL DEFAULT 'aguardando_pagamento';
-- aguardando_pagamento -> aguardando_onboarding -> provisionado

-- Id do Tenant criado no motor de e-commerce (POST /internal/provision-tenant
-- lá) depois que o onboarding termina — null até esse passo acontecer.
ALTER TABLE subscribers ADD COLUMN tenant_id text;

CREATE UNIQUE INDEX idx_subscribers_email ON subscribers (lower(email));
