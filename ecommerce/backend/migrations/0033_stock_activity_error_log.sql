CREATE TABLE IF NOT EXISTS eletronicos.stock_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'stock_item')),
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'deleted', 'stock_updated', 'low_stock', 'out_of_stock')),
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elt_stock_activity_tenant ON eletronicos.stock_activity_log(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS eletronicos.error_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source TEXT NOT NULL CHECK (source IN ('middleware', 'api', 'client', 'webhook')),
  level TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warn')),
  message TEXT NOT NULL,
  context JSONB,
  route TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elt_error_log_tenant ON eletronicos.error_log(tenant_id, created_at DESC);
