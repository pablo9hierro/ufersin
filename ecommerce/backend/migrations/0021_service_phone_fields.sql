-- Mesma extensão opcional que products ganhou (0020) — modelo de aparelho
-- e tipo de reparo, usados pelo módulo eletrônicos pra representar o
-- catálogo de reparo (categoria = marca, model_name + repair_type por
-- linha de serviço). NULL pra qualquer tenant que não usa.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS repair_type TEXT;
