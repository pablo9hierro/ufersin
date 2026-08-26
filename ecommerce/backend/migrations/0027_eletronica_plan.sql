-- Plano do ramo de assistência técnica no MOTOR.
--
-- A plataforma (backend/, platform_plans) passou a ter um plano próprio de
-- eletrônica (migration 0022 lá), mas o motor só conhecia
-- essential/management/premium -- provisionar um tenant com plan_code
-- 'eletronica' criaria uma assinatura apontando pra um plano inexistente e
-- o lojista ficaria SEM FEATURE NENHUMA (features::effective resolve pelo
-- plano da assinatura ativa). Este seed fecha esse buraco.
--
-- O CHECK original fixava a lista em essential/management/premium -- abre
-- pro código do novo ramo. Continua sendo lista fechada de propósito: um
-- código de plano fora dela não teria plan_features e o tenant ficaria sem
-- capacidade nenhuma, falhando de um jeito difícil de enxergar.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_code_check;
ALTER TABLE plans ADD CONSTRAINT plans_code_check
  CHECK (code = ANY (ARRAY['essential', 'management', 'premium', 'eletronica']));

-- Preço em centavos, igual aos demais (R$ 250,00 = 25000).
INSERT INTO plans (id, code, name, price_cents)
VALUES ('plan_eletronica', 'eletronica', 'Eletrônica', 25000)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, price_cents = EXCLUDED.price_cents;

-- Features do ramo. Reaproveita os mesmos códigos já existentes -- o que
-- muda entre os ramos é QUAL painel/vitrine o tenant recebe (vertical), não
-- a lista de capacidades básicas. `catalogo` cobre produtos e o catálogo de
-- serviços de reparo; `pedidos` cobre as solicitações de serviço.
-- Deliberadamente SEM as features de operação de delivery/CRM do ecommerce
-- (motoboy, comissoes, crm, campanhas...) -- não fazem parte deste ramo.
INSERT INTO plan_features (plan_id, feature_code)
SELECT 'plan_eletronica', code
FROM (VALUES ('catalogo'), ('checkout'), ('pix'), ('whatsapp'), ('pedidos')) AS f(code)
ON CONFLICT DO NOTHING;
