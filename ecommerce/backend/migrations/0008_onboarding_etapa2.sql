-- Etapa 2 do painel admin: horário salvo + histórico de conexão WhatsApp.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_hours_done BOOLEAN NOT NULL DEFAULT false;

-- Tenants já existentes não devem ser bloqueados pelo novo gate.
UPDATE tenants SET onboarding_hours_done = true;

CREATE TABLE IF NOT EXISTS whatsapp_connection_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('connected', 'disconnected', 'status')),
  previous_state TEXT,
  new_state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connection_events_tenant_created
  ON whatsapp_connection_events (tenant_id, created_at DESC);

ALTER TABLE whatsapp_connection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_events_tenant_isolation ON whatsapp_connection_events;
CREATE POLICY whatsapp_connection_events_tenant_isolation ON whatsapp_connection_events
  USING (tenant_id = current_setting('app.tenant_id', true));
