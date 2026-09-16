-- Corrige um bug real que estava derrubando o ecommerce-api em crash-loop:
-- seed.rs grava em `tenants.landing_hero_image_url` desde uma rodada
-- anterior (seed de Hero da vitrine demo), mas essa coluna nunca existiu
-- neste banco (foi confundida com uma coluna homonima da PLATAFORMA,
-- backend/migrations/0016, que e' um banco Postgres completamente
-- separado). Toda vez que o backend subia, o boot inteiro falhava aqui,
-- e o Railway ficava servindo a ultima imagem Docker que tinha conseguido
-- subir antes desse bug ser introduzido -- por isso nenhuma correcao das
-- ultimas rodadas (Kanban, vendas, hero, logo) nunca apareceu ao vivo.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS landing_hero_image_url TEXT;
