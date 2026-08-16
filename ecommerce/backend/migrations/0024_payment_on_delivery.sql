-- Preferência do cliente, no checkout do assistente/vitrine, de pagar o
-- produto (+ entrega) no ato da entrega em vez de no ato do pedido. Só tem
-- efeito prático quando o lojista habilitou isso em /meu-plano
-- (subscribers.pagamento_produto_na_entrega, plataforma) — aquele flag vive
-- fora deste schema (mesmo padrão de vender_externamente/apenas_retirada:
-- enforced no frontend, ver tenant.rs::tenant_for_slug). Aqui é só o registro
-- informativo de qual opção o cliente escolheu, pro lojista ver no pedido.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_on_delivery BOOLEAN NOT NULL DEFAULT false;
