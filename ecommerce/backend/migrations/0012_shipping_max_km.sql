-- Admin Frete (Essential+): max delivery radius in km.
-- NULL = no limit (same semantics as legacy sunset.shipping_settings.max_km).

ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS max_km DOUBLE PRECISION;
