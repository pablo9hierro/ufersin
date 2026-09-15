-- Parte 1/3/4 do plano de pagamento global de motoboy: substitui a
-- comissão-sempre-ativa-por-motoboy por uma config ÚNICA por loja
-- (comissão XOR fixo, nunca os dois) + registro de dias trabalhados +
-- flag de maquininha. Os campos antigos `motoboys.payment_frequency`/
-- `payment_fixed_value` (0042) permanecem na tabela por histórico, mas
-- deixam de ser lidos/escritos por motoboy -- a fonte de verdade agora é
-- esta tabela, tenant-wide.
CREATE TABLE IF NOT EXISTS motoboy_payroll_config (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  payment_model TEXT NOT NULL DEFAULT 'comissao' CHECK (payment_model IN ('comissao', 'fixo')),
  payment_frequency TEXT CHECK (payment_frequency IN ('diaria', 'semanal', 'quinzenal', 'mensal')),
  payment_fixed_value DOUBLE PRECISION,
  usa_maquininha BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE motoboy_payroll_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON motoboy_payroll_config
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Dias trabalhados (Parte 3): primeira atividade do dia (entrega marcada
-- "em rota") registra a data -- ON CONFLICT DO NOTHING garante que a
-- segunda corrida do mesmo dia não duplica.
CREATE TABLE IF NOT EXISTS motoboy_work_days (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  motoboy_id TEXT NOT NULL,
  work_date DATE NOT NULL,
  first_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (motoboy_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_motoboy_work_days_tenant ON motoboy_work_days(tenant_id);
CREATE INDEX IF NOT EXISTS idx_motoboy_work_days_motoboy ON motoboy_work_days(motoboy_id, work_date);
ALTER TABLE motoboy_work_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON motoboy_work_days
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
