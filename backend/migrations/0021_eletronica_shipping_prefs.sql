-- Preferências de deslocamento do ramo eletrônica (assistência técnica):
-- quais "pernas" do transporte do aparelho a loja oferece como cortesia.
-- Só fazem sentido quando `apenas_retirada = false` (loja que não faz
-- deslocamento nenhum não tem o que dar de graça).
--
-- Equivalente ao que hoje vive em `vrtech.shipping_settings.cobrar_coleta` /
-- `.cobrar_entrega` (semântica invertida: grátis = não cobra). A partir
-- daqui a plataforma passa a ser a fonte de verdade, e o painel do vrtech
-- só reflete — evita as duas telas divergirem.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS coleta_gratis BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_reparado_gratis BOOLEAN NOT NULL DEFAULT false;
