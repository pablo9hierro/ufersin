-- Generaliza `deliveries` pra aceitar tanto um pedido (orders, fluxo
-- genérico) quanto uma solicitação de serviço (eletronicos.service_requests,
-- coleta/entrega de aparelho em reparo) -- reaproveita 100% do orchestrator,
-- delivery_attempts, delivery_webhook_events e dedupe já existentes em vez
-- de duplicar a tabela inteira pro segundo fluxo.
-- service_requests.id e' uuid (nao text como orders.id) -- coluna nova
-- segue o tipo real em vez de forcar cast.
ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS service_request_id UUID
  REFERENCES eletronicos.service_requests(id) ON DELETE CASCADE;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_exactly_one_source
  CHECK ((order_id IS NOT NULL) != (service_request_id IS NOT NULL));

DROP INDEX IF EXISTS idx_deliveries_order_active;
CREATE UNIQUE INDEX idx_deliveries_order_active
  ON deliveries (COALESCE(order_id, service_request_id::text))
  WHERE status NOT IN ('cancelled', 'failed');
