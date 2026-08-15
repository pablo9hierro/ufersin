-- ETA de entrega baseado em distância: além do preço por km já existente,
-- o lojista configura quantos minutos estima por km rodado. 0 (padrão)
-- significa "não configurado" — nesse caso a API não calcula nem mostra
-- tempo estimado nenhum, só o preço (comportamento de hoje, inalterado).
ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS minutes_per_km DOUBLE PRECISION NOT NULL DEFAULT 0;
