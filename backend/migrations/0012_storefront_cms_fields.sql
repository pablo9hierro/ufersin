-- Textos da landing + FAB do carrinho editáveis em /meu-plano/layout.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS landing_headline text,
  ADD COLUMN IF NOT EXISTS landing_sub text,
  ADD COLUMN IF NOT EXISTS landing_badge text,
  ADD COLUMN IF NOT EXISTS cart_fab_style text NOT NULL DEFAULT 'sacola',
  ADD COLUMN IF NOT EXISTS cart_fab_animate boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscribers_cart_fab_style_check'
  ) THEN
    ALTER TABLE subscribers
      ADD CONSTRAINT subscribers_cart_fab_style_check
      CHECK (cart_fab_style IN ('sacola', 'cart_icon'));
  END IF;
END $$;
