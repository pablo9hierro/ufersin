-- Preferência do lojista: vai precisar de conta de usuário vendedor (PDV)?
-- Junto com precisa_tela_cozinha e tem_motoboy_proprio, decide se a loja
-- precisa da tela de cadastro de funcionário (vendedor/motoboy/cozinha)
-- liberada mesmo fora do plano management (ver sync-feature-flags).
ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS precisa_vendedor boolean NOT NULL DEFAULT false;
