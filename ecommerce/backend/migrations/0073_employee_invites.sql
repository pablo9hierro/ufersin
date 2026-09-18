-- Auto-cadastro de motoboy/vendedor via convite (link + código) mandado por
-- WhatsApp -- token vai na URL (não adivinhável), code é o que o funcionário
-- digita. Isolada de propósito de `eletronicos.consultation_otps` (OTP de
-- CLIENTE) -- tabela própria, nunca compartilhada entre os dois fluxos.
CREATE TABLE employee_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL CHECK (role IN ('motoboy','vendedor')),
  token TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  target_phone TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES admins(id),
  expires_at TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  used_at TEXT,
  created_employee_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_employee_invites_token ON employee_invites(token);
CREATE INDEX idx_employee_invites_tenant ON employee_invites(tenant_id);

ALTER TABLE employee_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_invites
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Avisos do sino pro fluxo de convite (boas-vindas ao funcionário, log de
-- cadastro pro lojista). Sem read_at/marcar-lido no primeiro corte -- sino
-- mostra as últimas N dos últimos 7 dias, mesmo espírito do PayrollBell atual.
CREATE TABLE employee_notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  audience TEXT NOT NULL CHECK (audience IN ('admin','motoboy','vendedor')),
  audience_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_employee_notifications_lookup ON employee_notifications(tenant_id, audience, audience_id, created_at);

ALTER TABLE employee_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_notifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
