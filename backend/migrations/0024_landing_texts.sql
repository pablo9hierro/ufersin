-- Textos avulsos da landing (botões, títulos de seção, rodapé) editáveis
-- via CMS em /meu-plano/layout -- mapa livre { chave: texto }, uma coluna
-- só em vez de uma nova por texto (evita migração toda vez que se quer
-- deixar mais um pedaço editável).
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS landing_texts jsonb;
