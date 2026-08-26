-- eletronicos.shipping_settings já existia (criada fora do histórico de
-- migrations, achado ao investigar erro 500) com PK em `id` (serial) + FK
-- solta em tenant_id, sem UNIQUE -- por isso o ON CONFLICT (tenant_id) do
-- endpoint novo falhava. Uma linha por tenant é o design real (já tinha
-- exatamente 1 linha pro tenant vrtech), então o UNIQUE só formaliza isso.
ALTER TABLE eletronicos.shipping_settings
  ADD CONSTRAINT shipping_settings_tenant_id_key UNIQUE (tenant_id);
