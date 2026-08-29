-- Formulação ERP (produto/serviço, motor genérico) ganha unidades de
-- comprimento (mm/cm/m/km) além de massa/volume/unidade -- faltavam pra
-- insumo vendido/consumido por comprimento (cabo, fita, tecido, etc.).
ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_unit_check;
ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_check
  CHECK (unit IN ('g', 'kg', 'ml', 'l', 'un', 'mm', 'cm', 'm', 'km'));

ALTER TABLE product_formulations DROP CONSTRAINT IF EXISTS product_formulations_unit_check;
ALTER TABLE product_formulations ADD CONSTRAINT product_formulations_unit_check
  CHECK (unit IN ('g', 'kg', 'ml', 'l', 'un', 'mm', 'cm', 'm', 'km'));

ALTER TABLE service_ingredients DROP CONSTRAINT IF EXISTS service_ingredients_unit_check;
ALTER TABLE service_ingredients ADD CONSTRAINT service_ingredients_unit_check
  CHECK (unit IN ('g', 'kg', 'ml', 'l', 'un', 'mm', 'cm', 'm', 'km'));
