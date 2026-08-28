-- 3 cards de destaque da landing (título + descrição cada), editáveis via
-- CMS em /meu-plano/layout -- mesmo padrão de landing_headline/sub/badge.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS landing_highlights jsonb;
