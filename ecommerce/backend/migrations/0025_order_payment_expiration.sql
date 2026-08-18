-- Pedido com Pix/link gerado e não pago some do jeito que o cliente
-- deixou (estoque reservado, pedido "pendente" pra sempre) se ninguém
-- cancelar. Prazo de validade: 30 min contados de quando o Pix/link foi
-- gerado (create_pix_payment/create_card_link) — passou disso sem pagar,
-- o worker order_expiration.rs cancela sozinho, devolvendo o estoque.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders(payment_expires_at)
  WHERE payment_status = 'pendente';

-- Cancelamento automático não é nem "cliente" nem "admin" — evita atribuir
-- a um humano uma ação que o sistema tomou sozinho.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cancel_by_check;
ALTER TABLE orders ADD CONSTRAINT orders_cancel_by_check
  CHECK (cancel_by IS NULL OR cancel_by IN ('cliente','admin','sistema'));
