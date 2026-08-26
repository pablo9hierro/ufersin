-- Config de frete pro ramo eletrônica (coleta/entrega de aparelho) --
-- porta shipping_settings do vrtech pro schema eletronicos, por tenant
-- (o original era single-row global; aqui cada loja tem a sua).
CREATE TABLE IF NOT EXISTS eletronicos.shipping_settings (
  tenant_id TEXT PRIMARY KEY,
  price_per_km NUMERIC NOT NULL DEFAULT 0,
  minutes_per_km NUMERIC NOT NULL DEFAULT 3,
  store_lat DOUBLE PRECISION,
  store_lng DOUBLE PRECISION,
  store_address TEXT NOT NULL DEFAULT '',
  max_km NUMERIC,
  cobrar_coleta BOOLEAN NOT NULL DEFAULT true,
  cobrar_entrega BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE eletronicos.shipping_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eletronicos.shipping_settings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
