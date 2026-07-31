-- Ciclo de cobrança da assinatura do lojista com a Rodoletas.
-- mensal = preço cheio /mês; semestral = 6 meses com 5% de desconto no total.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'mensal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscribers_billing_cycle_check'
  ) THEN
    ALTER TABLE subscribers
      ADD CONSTRAINT subscribers_billing_cycle_check
      CHECK (billing_cycle IN ('mensal', 'semestral'));
  END IF;
END $$;
