-- Achado real via log de produção: "duplicate key value violates unique
-- constraint shipping_settings_pkey" toda vez que um tenant NOVO tenta
-- criar sua primeira linha de shipping_settings (GET .../shipping-settings
-- -> 500, "Serviço de deslocamento" fica travado em loading pra sempre).
--
-- Causa raiz real: a coluna `id` da tabela nunca foi um SERIAL de verdade
-- -- o default era a constante literal `1` (não `nextval(...)`), então
-- TODO insert sem id explícito tentava `id = 1`, que já existia (linha do
-- tenant vrtech). Qualquer tenant novo colidia na hora.
CREATE SEQUENCE IF NOT EXISTS eletronicos.shipping_settings_id_seq;
SELECT setval(
  'eletronicos.shipping_settings_id_seq',
  COALESCE((SELECT MAX(id) FROM eletronicos.shipping_settings), 0) + 1,
  false
);
ALTER TABLE eletronicos.shipping_settings
  ALTER COLUMN id SET DEFAULT nextval('eletronicos.shipping_settings_id_seq');
ALTER SEQUENCE eletronicos.shipping_settings_id_seq
  OWNED BY eletronicos.shipping_settings.id;
