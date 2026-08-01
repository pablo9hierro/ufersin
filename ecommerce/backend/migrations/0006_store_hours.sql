-- Horário de funcionamento multi-tenant (Resolutoo). Antes no schema
-- `ufersin` do Supabase — o motor Railway usa tabelas com tenant_id.

CREATE TABLE IF NOT EXISTS store_hours (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT true,
  intervals JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS store_status (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  manually_closed BOOLEAN NOT NULL DEFAULT false,
  manual_closed_reason TEXT
);

-- Defaults 09:00–18:00 pra tenants já provisionados.
INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals)
SELECT t.id, d.day, true,
       jsonb_build_array(jsonb_build_object('opens_at', '09:00', 'closes_at', '18:00'))
FROM tenants t
CROSS JOIN generate_series(0, 6) AS d(day)
ON CONFLICT (tenant_id, day_of_week) DO NOTHING;

INSERT INTO store_status (tenant_id, manually_closed)
SELECT id, false FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
