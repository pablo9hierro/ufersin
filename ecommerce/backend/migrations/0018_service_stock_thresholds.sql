-- Limites de "baixo estoque" pra insumos (itens de estoque) e pra
-- serviços (tanto o próprio serviço quanto, na prática, seus insumos
-- ligados). E quantidade manual de serviço pra serviços SEM insumo
-- ligado (esses não têm de onde calcular disponibilidade automática).
ALTER TABLE ingredients ADD COLUMN low_stock_threshold DOUBLE PRECISION;
ALTER TABLE services ADD COLUMN low_stock_threshold DOUBLE PRECISION;
ALTER TABLE services ADD COLUMN manual_quantity DOUBLE PRECISION;
