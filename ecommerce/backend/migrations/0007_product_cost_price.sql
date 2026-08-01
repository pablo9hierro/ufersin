-- Custo de aquisição do produto (pra markup em /admin/produtos e
-- lucro em /admin/relatorios). Já existia no schema Supabase; Railway
-- não tinha a coluna — o form do admin gravava e o backend ignorava.

ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price DOUBLE PRECISION;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold BIGINT;
