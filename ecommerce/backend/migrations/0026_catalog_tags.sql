-- Tags de busca (palavras-chave + frases-chave) por produto/serviço,
-- geradas por IA. Ficam dentro de um accordion recolhido no card da
-- vitrine (interação real do usuário pra abrir, não display:none/CSS
-- offscreen) e alimentam o algoritmo/assistente de busca.
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
