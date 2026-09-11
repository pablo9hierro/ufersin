-- Plano "Starter" -- novo degrau ABAIXO de Essential no ramo ecommerce.
--
-- Mesmo padrao/precedente de 0027_eletronica_plan.sql: o motor so aceita
-- plan_code que exista em `plans` + `plans_code_check`; sem isso,
-- provisionar um tenant com "starter" criaria uma assinatura apontando pra
-- um plano inexistente e o lojista ficaria SEM FEATURE NENHUMA
-- (features::effective_features resolve pelo plano da assinatura ativa).
--
-- Posicionamento: mesma operacao basica de loja (catalogo, checkout, Pix,
-- gestao de pedidos) que o Essential, MENOS as notificacoes automaticas de
-- WhatsApp (features::whatsapp) -- e o unico diferencial de capacidade
-- entre os dois; o resto (funcionarios, motoboy, CRM etc.) permanece
-- exclusivo de Management/Premium, sem mudanca nenhuma. Preco e nome sao
-- só o seed inicial -- editaveis a qualquer momento via
-- PUT /api/superadmin/plans/starter na plataforma (platform_plans), sem
-- precisar de migration nova pra isso.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_code_check;
ALTER TABLE plans ADD CONSTRAINT plans_code_check
  CHECK (code = ANY (ARRAY['essential', 'management', 'premium', 'eletronica', 'starter']));

-- Preço em centavos (R$ 29,90 = 2990) -- só seed inicial, editável depois.
INSERT INTO plans (id, code, name, price_cents)
VALUES ('plan_starter', 'starter', 'Starter', 2990)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, price_cents = EXCLUDED.price_cents;

INSERT INTO plan_features (plan_id, feature_code)
SELECT 'plan_starter', code
FROM (VALUES ('catalogo'), ('checkout'), ('pix'), ('pedidos')) AS f(code)
ON CONFLICT DO NOTHING;
