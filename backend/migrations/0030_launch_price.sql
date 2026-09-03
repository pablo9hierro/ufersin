-- Preço de inauguração (promocional) por plano — quando definido, é o
-- valor que o cliente paga de fato ao assinar; price_monthly vira o valor
-- "normal" mostrado riscado ao lado. NULL = sem promoção, cobra o normal.
ALTER TABLE IF EXISTS platform_plans
  ADD COLUMN IF NOT EXISTS launch_price_monthly double precision;
