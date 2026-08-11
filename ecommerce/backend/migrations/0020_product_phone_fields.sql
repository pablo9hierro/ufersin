-- Campos opcionais de marca/modelo de aparelho — vieram do módulo
-- eletrônicos (VR Tech), disponíveis pra qualquer tenant que vender
-- eletrônicos, sem custo pros que não usam (ficam NULL).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS phone_brand TEXT,
  ADD COLUMN IF NOT EXISTS phone_model TEXT;
