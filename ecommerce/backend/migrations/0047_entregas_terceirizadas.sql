-- Modulo de entregas terceirizadas (Uber Direct). Beta: feature liberada so
-- por linha em feature_flags (nunca por hardcode de slug no codigo-fonte) --
-- ver Feature::EntregaTerceirizada em features.rs.

INSERT INTO features (code, name, description) VALUES
  ('entrega_terceirizada', 'Entregas terceirizadas', 'Despacho de entrega via Uber Direct pra lojas sem motoboy proprio')
ON CONFLICT (code) DO NOTHING;

-- Preferencia por tenant: modo de acionamento + estrategia de provider.
-- primary_provider/fallback_provider guardam o provider_code ('uber_direct'
-- por enquanto -- coluna fica pronta pra um proximo provider real); fallback
-- so roda se o primario falhar (nunca paralelo).
CREATE TABLE IF NOT EXISTS tenant_delivery_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'automatico')),
  primary_provider TEXT CHECK (primary_provider IN ('uber_direct')),
  fallback_provider TEXT CHECK (fallback_provider IN ('uber_direct')),
  -- Diferenca maxima (R$) entre o que o cliente pagou e o custo real do
  -- provider que ainda permite fallback automatico sem intervencao humana
  -- (secao 12 do pedido) -- estrutura pronta, sem UI complexa ainda.
  max_auto_diff DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);

-- Credenciais por provider, por tenant -- mesmo padrao de
-- subscribers.plataforma_credenciais (jsonb, nunca devolvido bruto pro
-- frontend, so status/mascara).
CREATE TABLE IF NOT EXISTS delivery_provider_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('uber_direct')),
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'desconectado' CHECK (status IN ('desconectado', 'conectado', 'erro')),
  connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, provider)
);

-- Uma entrega por pedido. O indice unico parcial abaixo e a defesa real
-- contra despacho duplicado por concorrencia (secao 30): duas tentativas
-- simultaneas de dispatch pro mesmo pedido colidem no INSERT, so uma vence.
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'quote_requested' CHECK (status IN (
    'quote_requested', 'created', 'courier_assigned', 'en_route_to_pickup',
    'picked_up', 'en_route_to_dropoff', 'delivered', 'cancelled', 'failed'
  )),
  -- Fixado no momento do dispatch a partir do que o cliente ja pagou
  -- (orders.shipping_price) -- nunca sobrescrito depois (secao 10-11).
  customer_delivery_fee DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_order_active
  ON deliveries (order_id)
  WHERE status NOT IN ('cancelled', 'failed');
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant ON deliveries (tenant_id);

-- Uma linha por tentativa (provider principal, depois fallback se precisar)
-- -- nunca sobrescreve a anterior, so acrescenta (secao 5/26).
CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('uber_direct')),
  external_delivery_id TEXT,
  status TEXT NOT NULL,
  quote_amount DOUBLE PRECISION,
  -- Custo real cobrado pelo provider (dominio operacional, nunca confundido
  -- com customer_delivery_fee -- secao 10).
  provider_cost DOUBLE PRECISION,
  request_id TEXT,
  failure_reason TEXT,
  raw_response JSONB,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  failed_at TEXT,
  UNIQUE (delivery_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_delivery ON delivery_attempts (delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_external ON delivery_attempts (provider, external_delivery_id);

-- Dedup real de webhook (secao 19) -- o resto do sistema nao tem uma tabela
-- assim porque payment_status/order.status ja sao idempotentes por
-- natureza; webhook de delivery precisa de defesa explicita.
CREATE TABLE IF NOT EXISTS delivery_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('uber_direct')),
  external_event_id TEXT NOT NULL,
  delivery_attempt_id TEXT REFERENCES delivery_attempts(id) ON DELETE SET NULL,
  payload JSONB,
  processed_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (provider, external_event_id)
);
