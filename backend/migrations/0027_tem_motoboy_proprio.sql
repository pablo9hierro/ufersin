-- Preferência do lojista: tem motoboy próprio pra fazer as entregas? Quando
-- ligada, pedidos prontos pra entrega caem na fila do motoboy (tela
-- própria). Quando desligada, o lojista chama um motoboy/99pop terceiro na
-- hora -- o card do pedido no status "entrega" mostra a geolocalização do
-- cliente pra facilitar repassar o endereço.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS tem_motoboy_proprio boolean NOT NULL DEFAULT false;
