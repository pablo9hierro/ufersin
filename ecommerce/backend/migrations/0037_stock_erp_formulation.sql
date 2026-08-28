-- ERP Formulação pra item de estoque da eletrônica: um insumo cadastrado
-- em lote (ex: "Pasta térmica" 100g por R$100) cujo custo por unidade de
-- medida (R$1/g) é usado quando um serviço declara quanto consome dele.
-- Antes só existia vínculo direto quantidade-a-quantidade (1 peça = 1
-- peça) -- sem noção de unidade nem conversão.
ALTER TABLE eletronicos.stock_items
  ADD COLUMN IF NOT EXISTS origin_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (origin_type IN ('manual', 'erp_formulation'));

-- Unidades expandidas (antes só unidade/caixa) -- massa (g/kg), volume
-- (ml/l), comprimento (cm/m) além das discretas.
ALTER TABLE eletronicos.stock_items DROP CONSTRAINT IF EXISTS stock_items_unit_check;
ALTER TABLE eletronicos.stock_items ADD CONSTRAINT stock_items_unit_check
  CHECK (unit IN ('unidade', 'caixa', 'par', 'pacote', 'rolo', 'g', 'kg', 'ml', 'l', 'cm', 'm'));

-- Unidade do consumo declarado no vínculo serviço->peça -- antes a
-- quantidade era sempre implicitamente na mesma unidade da peça (sem
-- conversão possível). Default 'unidade' preserva o comportamento antigo
-- pra vínculos já existentes (linhas atuais são todas peças unidade/caixa).
ALTER TABLE eletronicos.service_catalog_item_parts
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'unidade'
  CHECK (unit IN ('unidade', 'caixa', 'par', 'pacote', 'rolo', 'g', 'kg', 'ml', 'l', 'cm', 'm'));

-- Movimentação de baixa por consumo real (checklist da OS completada com
-- quantidade/unidade do vínculo peça-serviço, não mais fixo em 1 unidade).
ALTER TABLE eletronicos.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_unit_check;
ALTER TABLE eletronicos.stock_movements ADD CONSTRAINT stock_movements_unit_check
  CHECK (unit IN ('unidade', 'caixa', 'par', 'pacote', 'rolo', 'g', 'kg', 'ml', 'l', 'cm', 'm'));
