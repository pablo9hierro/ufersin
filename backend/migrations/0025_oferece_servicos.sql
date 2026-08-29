-- Preferência do lojista (motor ecommerce genérico, opcional): oferece
-- serviços além de produtos? Liga o botão "Ver serviços" na vitrine e a
-- aba de cadastro de serviços no admin. Eletrônica não usa esta coluna --
-- lá é sempre obrigatório, sem opção de desligar.
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS oferece_servicos boolean NOT NULL DEFAULT false;
