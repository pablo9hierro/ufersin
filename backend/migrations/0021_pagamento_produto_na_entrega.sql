-- Preferências de venda (/meu-plano), exclusivo do ramo eletrônicos (vertical
-- 'eletronicos'): permite ao lojista aceitar pagamento do produto (+ entrega)
-- no ato da entrega, em vez de exigir pagamento no checkout.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS pagamento_produto_na_entrega BOOLEAN NOT NULL DEFAULT false;
