-- Loja aceita apenas compras com retirada no local (sem entrega/frete/motoboy
-- para clientes externos da vitrine). Preferência editável em /meu-plano.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS apenas_retirada BOOLEAN NOT NULL DEFAULT false;
