-- Preferências de venda (/meu-plano):
--  - pagamento_na_retirada: cobrança de pedidos de retirada só no ato da retirada
--  - entrega_somente_pix: entrega só com Pix já pago no checkout
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS pagamento_na_retirada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_somente_pix BOOLEAN NOT NULL DEFAULT false;
