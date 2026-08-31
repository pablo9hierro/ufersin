-- Preferência do lojista: precisa de uma tela de cozinha separada pra
-- avançar status de pedido? Quando ligada, pedidos deixam de aparecer em
-- /admin/pedidos e passam a cair direto na tela de cozinha.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS precisa_tela_cozinha boolean NOT NULL DEFAULT false;
