-- Pagamento fixo periódico (diária/semanal/quinzenal/mensal) de motoboy e
-- vendedor: alerta 2 dias antes do vencimento, admin informa que pagou,
-- funcionário confirma recebimento (só confirma, nunca recusa) -- confirmar
-- é o que efetivamente zera o ciclo (reseta last_payroll_reset_at).
ALTER TABLE motoboys
  ADD COLUMN IF NOT EXISTS last_payroll_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE vendedores
  ADD COLUMN IF NOT EXISTS last_payroll_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS payroll_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_role TEXT NOT NULL CHECK (employee_role IN ('motoboy', 'vendedor')),
  employee_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  payment_method TEXT NOT NULL,
  confirmed_by_employee BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_tenant ON payroll_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_employee ON payroll_payments(employee_role, employee_id);

ALTER TABLE payroll_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_payments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
