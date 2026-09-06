-- Mercado Pago Point/POS (maquininha) + endurecimento de Comandas.
--
-- Point reaproveita o MESMO token OAuth por tenant que Pix/Cartão já usam
-- (tenants.plataforma_credenciais, ver tenant::mp_access_token()) -- nenhuma
-- credencial nova, nenhum OAuth novo.

INSERT INTO features (code, name, description) VALUES
  ('mercadopago_point', 'Mercado Pago Point', 'Cobrança via maquininha Point/POS')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS mp_point_stores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mp_store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, mp_store_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_point_stores_tenant ON mp_point_stores (tenant_id);

CREATE TABLE IF NOT EXISTS mp_point_pos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES mp_point_stores(id) ON DELETE SET NULL,
  mp_pos_id TEXT,
  -- Referência idempotente enviada NA CRIAÇÃO pro Mercado Pago -- permite
  -- reconhecer "essa mesma caixa" numa nova tentativa sem duplicar (mesmo
  -- espírito do external_reference já usado em fiscal_documents/deliveries).
  external_pos_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  terminal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, external_pos_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_point_pos_tenant ON mp_point_pos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mp_point_pos_store ON mp_point_pos (store_id);

CREATE TABLE IF NOT EXISTS mp_point_terminals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mp_terminal_id TEXT NOT NULL,
  pos_id TEXT REFERENCES mp_point_pos(id) ON DELETE SET NULL,
  serial TEXT,
  model TEXT,
  operating_mode TEXT,
  status TEXT,
  -- Mercado Pago é a fonte externa de verdade pro estado do terminal --
  -- este registro é só um espelho, sempre pode estar desatualizado até o
  -- próximo /sync (nunca tratado como definitivo sem re-consultar).
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, mp_terminal_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_point_terminals_tenant ON mp_point_terminals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mp_point_terminals_pos ON mp_point_terminals (pos_id);

CREATE TABLE IF NOT EXISTS mp_point_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mp_order_id TEXT,
  pos_id TEXT REFERENCES mp_point_pos(id) ON DELETE SET NULL,
  -- Vínculo opcional com o que gerou a cobrança (comanda ou pedido) --
  -- nunca obrigatório, o Point também serve venda avulsa direta.
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  comanda_id TEXT REFERENCES comandas(id) ON DELETE SET NULL,
  employee_role TEXT,
  employee_id TEXT,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'pending', 'in_process', 'approved', 'rejected', 'canceled', 'refunded', 'failed', 'unknown'
  )),
  -- Idempotência real: nunca duas cobranças ativas pra mesma referência,
  -- mesmo padrão de fiscal_documents/deliveries (índice único parcial).
  external_reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_point_orders_ref_active
  ON mp_point_orders (external_reference)
  WHERE status NOT IN ('canceled', 'rejected', 'failed');
CREATE INDEX IF NOT EXISTS idx_mp_point_orders_tenant ON mp_point_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mp_point_orders_pos ON mp_point_orders (pos_id);

-- Dedupe de webhook, mesmo padrão de delivery_webhook_events (0047) --
-- status de cobrança Point não é naturalmente idempotente por estado como
-- payment_status de Pix, então dedupe explícito por evento.
CREATE TABLE IF NOT EXISTS mp_point_webhook_events (
  id TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

-- Funcionário x POS: N:N (um funcionário pode ter vários POS permitidos +
-- um padrão) -- evita refatoração destrutiva se amanhã precisar de mais de
-- um por pessoa. employee_role+employee_id porque vendedor/motoboy/cozinha
-- são tabelas separadas hoje (sem FK única possível pro trio).
CREATE TABLE IF NOT EXISTS mp_point_employee_pos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_role TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  pos_id TEXT NOT NULL REFERENCES mp_point_pos(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (employee_role, employee_id, pos_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_point_employee_pos_tenant ON mp_point_employee_pos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mp_point_employee_pos_employee ON mp_point_employee_pos (employee_role, employee_id);

-- Point Tap: só flag interna + e-mail do convite -- nunca senha/login do
-- Mercado Pago (isso permanece 100% gerenciado pelo app oficial deles).
ALTER TABLE vendedores
  ADD COLUMN IF NOT EXISTS point_tap_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS point_tap_invite_email TEXT;

-- ---------- Endurecimento de Comandas ----------

-- Optimistic locking: toda escrita em comanda passa a exigir o `version`
-- que o cliente leu por último (UPDATE ... WHERE version = $n), pra nunca
-- sobrescrever silenciosamente uma alteração concorrente (vendedor x PDV
-- mexendo ao mesmo tempo).
ALTER TABLE comandas
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS comanda_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comanda_id TEXT NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
  employee_role TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'COMMAND_CREATED', 'ITEM_ADDED', 'ITEM_REMOVED', 'ITEM_REPLACED',
    'COMMAND_FINALIZED', 'COMMAND_CANCELLED'
  )),
  item_id TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comanda_history_comanda ON comanda_history (comanda_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comanda_history_tenant ON comanda_history (tenant_id);

-- RLS por tenant, mesmo padrão de comandas/comanda_items (0044) -- defesa
-- em profundidade além do filtro explícito de tenant_id em toda query.
ALTER TABLE comanda_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comanda_history
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mp_point_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mp_point_stores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mp_point_pos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mp_point_pos
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mp_point_terminals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mp_point_terminals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mp_point_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mp_point_orders
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mp_point_employee_pos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mp_point_employee_pos
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
