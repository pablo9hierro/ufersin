-- Preferência do lojista: quando oferece serviços, atende a domicílio
-- (o cliente pode pedir pra ir até ele) além de presencial na loja.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS atende_domicilio boolean NOT NULL DEFAULT false;
