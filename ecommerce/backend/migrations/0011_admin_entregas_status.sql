-- Essential-plan admin delivery tray: status `entregas` mirrors `retiradas`
-- (merchant arranges delivery themselves; no motoboy staff).

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pendente','montando_pedido','pedido_pronto','aguardando_localizacao',
    'em_rota_de_entrega','entregue','retiradas','entregas','concluido'
  ));
