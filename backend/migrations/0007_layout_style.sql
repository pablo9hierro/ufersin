-- Estilo de vitrine do assinante (uiux2/3/4 no motor).
-- Padrão ufersin; trocável no onboarding e em /meu-plano.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS layout_style text NOT NULL DEFAULT 'ufersin';

ALTER TABLE subscribers
  DROP CONSTRAINT IF EXISTS subscribers_layout_style_check;

ALTER TABLE subscribers
  ADD CONSTRAINT subscribers_layout_style_check
  CHECK (layout_style IN ('ufersin', 'burgerbite', 'burgerhouse'));
