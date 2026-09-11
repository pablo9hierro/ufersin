-- Produto passa a poder herdar de um perfil fiscal (migration 0056). Os
-- campos fiscais que ja existem em products (cfop/cst/csosn/cest/
-- cclass_trib, migration 0050) continuam existindo com o MESMO significado
-- de sempre -- mas agora sao OVERRIDES opcionais sobre o perfil, nao mais
-- o valor final direto. Produto sem fiscal_profile_id e sem overrides
-- simplesmente nao pode ser emitido (ver resolution.rs::resolve), igual
-- ao comportamento nullable ja documentado na 0050.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fiscal_profile_id TEXT REFERENCES fiscal_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_fiscal_profile ON products (fiscal_profile_id);
