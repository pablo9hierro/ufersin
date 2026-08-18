-- Templates de mensagem automática editáveis pelo lojista (/admin/template)
-- — até aqui TODO texto de WhatsApp enviado ao cliente era string hardcoded
-- em Rust (whatsapp::notify), sem nenhuma forma de o lojista mudar.
-- Genérico por `template_key` pra a página crescer com outros disparos
-- depois, sem migration nova por template.
CREATE TABLE IF NOT EXISTS message_templates (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  template_key TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Só pros templates que disparam por tempo (hoje: 'agendamento_atraso').
  -- Quantos minutos DEPOIS do horário marcado esperar antes de mandar —
  -- a "tolerância de atraso" do cliente.
  trigger_delay_minutes INTEGER NOT NULL DEFAULT 15,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, template_key)
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Marca que o disparo de atraso já foi mandado pra esse agendamento —
-- sem isso o worker remandaria a mesma mensagem a cada tick (a cada
-- minuto) enquanto o cliente não aparecesse.
ALTER TABLE service_appointments ADD COLUMN IF NOT EXISTS late_notified_at TIMESTAMPTZ;

-- Índice do worker: varre só agendamento ativo que ainda não foi avisado.
CREATE INDEX IF NOT EXISTS idx_service_appointments_late_sweep
  ON service_appointments(scheduled_at)
  WHERE status = 'agendado' AND late_notified_at IS NULL;
