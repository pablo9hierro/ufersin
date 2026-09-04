-- Confirmado por teste real contra o sandbox da Uber Direct nesta sessao:
-- pickup_address/dropoff_address sem city/state preenchidos geocodificam
-- errado (distancia calculada de 718 milhas ao inves de ~4). Uber exige
-- esses campos estruturados pra geocodificar direito -- guardado uma vez
-- por tenant (loja e cliente ficam na mesma cidade, o proprio raio de
-- entrega da Uber ja restringe isso).
ALTER TABLE tenant_delivery_settings
  ADD COLUMN IF NOT EXISTS pickup_city TEXT,
  ADD COLUMN IF NOT EXISTS pickup_state TEXT;
