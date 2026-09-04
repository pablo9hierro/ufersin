-- Preferência de /meu-plano: como a loja despacha entrega terceirizada
-- quando não tem motoboy próprio (Uber Direct automático vs manual). NULL =
-- ainda não decidiu, trata como manual (comportamento atual preservado).
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS entrega_terceirizada_modo TEXT
  CHECK (entrega_terceirizada_modo IN ('manual', 'automatico'));
