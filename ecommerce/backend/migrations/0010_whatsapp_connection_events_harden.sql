-- Harden WhatsApp connection history: ensure table exists (idempotent if
-- 0008 already applied), allow QR/status rows, and give INSERT a WITH CHECK
-- so tenant_tx-scoped writes succeed under RLS.

CREATE TABLE IF NOT EXISTS whatsapp_connection_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relax CHECK so 'qr' / future states don't reject writes mid-deploy.
ALTER TABLE whatsapp_connection_events DROP CONSTRAINT IF EXISTS whatsapp_connection_events_event_type_check;
ALTER TABLE whatsapp_connection_events
  ADD CONSTRAINT whatsapp_connection_events_event_type_check
  CHECK (event_type IN ('connected', 'disconnected', 'status', 'qr'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_connection_events_tenant_created
  ON whatsapp_connection_events (tenant_id, created_at DESC);

ALTER TABLE whatsapp_connection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_events_tenant_isolation ON whatsapp_connection_events;
CREATE POLICY whatsapp_connection_events_tenant_isolation ON whatsapp_connection_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));
