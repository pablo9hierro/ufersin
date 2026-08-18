-- Agendamento de horário (marcar/desmarcar/editar) — pedido explícito pra
-- expandir a tool consultar_horario_funcionamento do Assistente IA.
-- Schema genérico (não em `eletronicos`) porque agendamento é um conceito
-- que serve qualquer vertical, não só assistência técnica — mesmo
-- isolamento por tenant do resto do banco (RLS), sem FK cross-schema.
CREATE TABLE IF NOT EXISTS service_appointments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado', 'cancelado', 'concluido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_appointments_tenant_scheduled ON service_appointments(tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_service_appointments_tenant_phone ON service_appointments(tenant_id, customer_phone);

ALTER TABLE service_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_appointments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
