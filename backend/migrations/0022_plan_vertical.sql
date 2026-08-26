-- Plano passa a saber a qual RAMO pertence.
--
-- Antes: os planos (essential/management/premium) eram degraus de preço
-- neutros, e o ramo (ecommerce vs eletronicos) era escolhido só depois, no
-- onboarding, num seletor separado -- nada ligava "o card que o cliente
-- clicou" ao ramo que ele ia receber. Com a landing passando a oferecer um
-- card exclusivo de assistência técnica, o ramo precisa viajar junto do
-- plano desde o clique, senão o cliente assina o plano de eletrônica e cai
-- num onboarding perguntando de novo qual é o ramo (e podendo escolher
-- ecommerce, o oposto do que ele comprou).
--
-- DEFAULT 'ecommerce': todo plano já cadastrado hoje é de ecommerce -- a
-- coluna nasce correta pro que existe, sem precisar de backfill manual.
ALTER TABLE platform_plans
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'ecommerce';

-- Mesma lista fechada já validada em ecommerce/backend (0019_tenant_vertical)
-- e em backend/src/routes/onboarding.rs -- nunca deixar entrar um terceiro
-- valor silenciosamente, senão o gating de features não sabe o que fazer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_plans_vertical_check'
  ) THEN
    ALTER TABLE platform_plans
      ADD CONSTRAINT platform_plans_vertical_check
      CHECK (vertical IN ('ecommerce', 'eletronicos'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_plans_vertical
  ON platform_plans(vertical, sort_order);

-- Backfill: assinante de eletrônica que ficou com plano de ecommerce.
-- No modelo antigo plano e ramo eram independentes (o ramo era escolhido
-- num seletor solto do onboarding), então dava pra ter vertical=eletronicos
-- com plan_code=essential. Agora que o ramo é DERIVADO do plano, essa
-- combinação faria um re-onboarding virar a loja pra ecommerce e ligar as
-- features erradas. Alinha o plano ao ramo que o lojista já tem.
-- Mesmo preço (R$ 250) -> sem impacto de cobrança.
UPDATE subscribers
SET plan_code = 'eletronica'
WHERE vertical = 'eletronicos'
  AND plan_code IN ('essential', 'management', 'premium');
